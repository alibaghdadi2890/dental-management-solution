import {
  type CreateSupplier,
  type ExportLanguage,
  formatGoodsReceiptNumber,
  fromCents,
  type PaymentMethod,
  type RecordSupplierAdjustment,
  type RecordSupplierPayment,
  type Supplier,
  type SupplierAccounts,
  type SupplierAdjustment,
  type SupplierOpeningBalance,
  type SupplierPayment,
  type SupplierStatement,
  type SupplierStatementQuery,
  toCents,
  type UpdateSupplier,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import { csvRow, UTF8_BOM } from '../../../platform/kernel/csv';
import { requestHash } from '../../../platform/kernel/request-hash';
import { AuditService } from '../../audit';
import { TenancyService } from '../../tenancy';
import {
  InventoryIdempotencyMismatchError,
  InventoryNameTakenError,
  InventoryNotFoundError,
  OneOffPaymentError,
  SupplierPaymentVoidedError,
} from '../domain/inventory-errors';
import {
  type SupplierAccountSources,
  supplierFigures,
  supplierStatement,
} from '../domain/supplier-account';
import {
  SUPPLIER_PAYMENT_RECORDED,
  SUPPLIER_PAYMENT_VOIDED,
  type SupplierPaymentRecorded,
  type SupplierPaymentVoided,
} from '../events/inventory-events';
import { CatalogRepository, type StoredSupplier } from '../persistence/catalog.repository';
import { MoneyRepository, type StoredPayment } from '../persistence/money.repository';
import { StockRepository } from '../persistence/stock.repository';
import { INVENTORY_EXPORT_LABELS } from './export-labels';
import { InventoryCalendar } from './inventory-calendar';
import { toAdjustment, toPayment, toSupplier, totalOf } from './presenter';

export interface CsvFile {
  fileName: string;
  body: string;
}

const SUPPLIER_FIELDS = [
  'name',
  'contactPerson',
  'phone',
  'email',
  'address',
  'note',
  'active',
] as const;

/** A payment written by a receipt in its own step: Paid now, or a one-off purchase's (B1). */
export interface ReceiptPayment {
  supplier: StoredSupplier | null;
  payee: string;
  receiptId: string;
  branchId: string;
  paidOn: string;
  amount: string;
  method: PaymentMethod;
  reference: string | null;
}

/**
 * Suppliers and their accounts (feature 20a, Part D; docs/modules/inventory.md). The directory is
 * read with `inventory:read` and kept with `inventory:manage`; an account is read with
 * `inventory:money_read` and written with `inventory:money_manage` (ADR-0101). The account is
 * computed (ADR-0098); every payment is mirrored into Expenses through `SupplierPaymentRecorded`.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly calendar: InventoryCalendar,
    private readonly tenancy: TenancyService,
    private readonly catalog: CatalogRepository,
    private readonly money: MoneyRepository,
    private readonly stock: StockRepository,
  ) {}

  // --- Directory ---

  list(includeInactive = false): Promise<Supplier[]> {
    this.context.requirePermission('inventory:read');
    return this.tenantDb.run(async () => {
      const money = this.context.hasPermission('inventory:money_read');
      return (await this.catalog.suppliers(includeInactive)).map((row) => toSupplier(row, money));
    });
  }

  get(id: string): Promise<Supplier> {
    this.context.requirePermission('inventory:read');
    return this.tenantDb.run(async () =>
      toSupplier(await this.require(id), this.context.hasPermission('inventory:money_read')),
    );
  }

  create(input: CreateSupplier): Promise<Supplier> {
    this.context.requirePermission('inventory:manage');
    return this.tenantDb.run(async () => {
      if (await this.catalog.supplierByName(input.name)) throw this.nameTaken(input.name);
      const row = await this.catalog.insertSupplier({
        ...input,
        currency: await this.calendar.currency(),
        createdBy: this.context.requireUserId(),
      });
      await this.audit.record({
        action: 'inventory_supplier.create',
        resourceType: 'inventory_supplier',
        resourceId: row.id,
        after: { name: row.name },
      });
      return toSupplier(row, this.context.hasPermission('inventory:money_read'));
    });
  }

  update(id: string, patch: UpdateSupplier): Promise<Supplier> {
    this.context.requirePermission('inventory:manage');
    return this.tenantDb.run(async () => {
      const before = await this.require(id, true);
      const changed: Record<string, unknown> = {};
      const record = before as unknown as Record<string, unknown>;
      for (const field of SUPPLIER_FIELDS) {
        if (patch[field] !== undefined && patch[field] !== record[field]) {
          changed[field] = patch[field];
        }
      }
      if (
        typeof changed.name === 'string' &&
        (await this.catalog.supplierByName(changed.name, id))
      ) {
        throw this.nameTaken(changed.name);
      }
      const row =
        Object.keys(changed).length === 0 ? before : await this.catalog.updateSupplier(id, changed);
      if (Object.keys(changed).length > 0) {
        await this.audit.record({
          action: 'inventory_supplier.update',
          resourceType: 'inventory_supplier',
          resourceId: id,
          before: {
            name: before.name,
            ...Object.fromEntries(Object.keys(changed).map((field) => [field, record[field]])),
          },
          after: { name: row.name, ...changed },
        });
      }
      return toSupplier(row, this.context.hasPermission('inventory:money_read'));
    });
  }

  /** The supplier an imported row names, or null (B8). */
  async idByName(name: string): Promise<string | null> {
    this.context.requirePermission('inventory:read');
    return this.tenantDb.run(async () => (await this.catalog.supplierByName(name))?.id ?? null);
  }

  // --- Money ---

  /** A replace: the same request again changes nothing, so a retry never duplicates. */
  setOpeningBalance(id: string, input: SupplierOpeningBalance): Promise<Supplier> {
    this.context.requirePermission('inventory:money_manage');
    return this.tenantDb.run(async () => {
      const before = await this.require(id, true);
      await this.calendar.assertNotFuture(input.asOf);
      const amount = fromCents(toCents(input.amount));
      const row = await this.catalog.updateSupplier(id, {
        openingBalance: amount,
        openingBalanceOn: input.asOf,
      });
      if (before.openingBalance !== amount || before.openingBalanceOn !== input.asOf) {
        await this.audit.record({
          action: 'inventory_supplier.opening_balance',
          resourceType: 'inventory_supplier',
          resourceId: id,
          before: {
            name: before.name,
            amount: before.openingBalance,
            asOf: before.openingBalanceOn,
          },
          after: { name: row.name, amount, asOf: input.asOf, currency: row.currency },
        });
      }
      return toSupplier(row, true);
    });
  }

  recordPayment(id: string, input: RecordSupplierPayment, key: string): Promise<SupplierPayment> {
    this.context.requirePermission('inventory:money_manage');
    return this.tenantDb.run(async () => {
      const hash = requestHash({ supplierId: id, payment: input });
      await this.catalog.lockKey('payment', key);
      const first = await this.money.paymentByKey(key);
      if (first) {
        if (first.idempotencyHash !== hash) throw this.mismatch();
        return toPayment(first);
      }
      const supplier = await this.require(id, true);
      await this.calendar.assertNotFuture(input.paidOn);
      const row = await this.insertPayment(
        {
          supplierId: supplier.id,
          receiptId: null,
          payee: null,
          paidOn: input.paidOn,
          amount: input.amount,
          method: input.method,
          reference: input.reference,
          note: input.note,
          idempotencyKey: key,
          idempotencyHash: hash,
        },
        supplier.name,
        null,
      );
      return toPayment(row);
    });
  }

  /**
   * The payment a receipt makes in its own transaction (B1): _Paid now_ on a registered
   * supplier's account, or a one-off purchase's payment. The caller has checked
   * `inventory:money_manage`.
   */
  async payForReceipt(input: ReceiptPayment): Promise<StoredPayment> {
    await this.calendar.assertNotFuture(input.paidOn);
    return this.insertPayment(
      {
        supplierId: input.supplier?.id ?? null,
        receiptId: input.receiptId,
        payee: input.supplier ? null : input.payee,
        paidOn: input.paidOn,
        amount: input.amount,
        method: input.method,
        reference: input.reference,
        note: null,
        idempotencyKey: null,
        idempotencyHash: null,
      },
      input.payee,
      input.branchId,
    );
  }

  /** Stays visible, struck through; its Expenses row is voided in the same transaction. */
  voidPayment(paymentId: string, reason: string): Promise<SupplierPayment> {
    this.context.requirePermission('inventory:money_manage');
    return this.tenantDb.run(async () => {
      const payment = await this.money.lockPayment(paymentId);
      if (payment && payment.supplierId === null) {
        throw new OneOffPaymentError('Void the one-off purchase instead');
      }
      return toPayment(await this.voidPaymentRow(paymentId, reason));
    });
  }

  /** A one-off purchase's payment goes with its receipt (B1). */
  async voidPaymentRow(paymentId: string, reason: string): Promise<StoredPayment> {
    const before = await this.money.lockPayment(paymentId);
    if (!before) throw new InventoryNotFoundError('No such payment', { paymentId });
    if (before.voidedAt !== null) throw new SupplierPaymentVoidedError('This payment is voided');
    const row = await this.money.voidPayment(
      paymentId,
      this.calendar.now(),
      this.context.requireUserId(),
      reason,
    );
    const supplier = row.supplierId ? await this.catalog.supplier(row.supplierId) : undefined;
    await this.audit.record({
      action: 'inventory_payment.void',
      resourceType: 'inventory_payment',
      resourceId: paymentId,
      before: { voided: false },
      after: {
        voided: true,
        payee: supplier?.name ?? row.payee,
        amount: row.amount,
        currency: row.currency,
        paidOn: row.paidOn,
      },
      reason,
    });
    const event: SupplierPaymentVoided = this.events.create(SUPPLIER_PAYMENT_VOIDED, {
      paymentId,
      reason,
    });
    await this.events.publish(event);
    return row;
  }

  recordAdjustment(
    id: string,
    input: RecordSupplierAdjustment,
    key: string,
  ): Promise<SupplierAdjustment> {
    this.context.requirePermission('inventory:money_manage');
    return this.tenantDb.run(async () => {
      const hash = requestHash({ supplierId: id, adjustment: input });
      await this.catalog.lockKey('adjustment', key);
      const first = await this.money.adjustmentByKey(key);
      if (first) {
        if (first.idempotencyHash !== hash) throw this.mismatch();
        return toAdjustment(first);
      }
      const supplier = await this.require(id, true);
      await this.calendar.assertNotFuture(input.onDate);
      const row = await this.money.insertAdjustment({
        supplierId: id,
        onDate: input.onDate,
        kind: input.kind,
        amount: fromCents(toCents(input.amount)),
        currency: await this.calendar.currency(),
        reason: input.reason,
        createdBy: this.context.requireUserId(),
        idempotencyKey: key,
        idempotencyHash: hash,
      });
      await this.audit.record({
        action: 'inventory_adjustment.record',
        resourceType: 'inventory_adjustment',
        resourceId: row.id,
        after: {
          supplierName: supplier.name,
          kind: row.kind,
          amount: row.amount,
          currency: row.currency,
          onDate: row.onDate,
        },
        reason: input.reason,
      });
      return toAdjustment(row);
    });
  }

  /** Every supplier's outstanding, and the clinic's total (D). */
  accounts(): Promise<SupplierAccounts> {
    this.context.requirePermission('inventory:money_read');
    return this.tenantDb.run(async () => {
      const rows = await this.catalog.suppliers(true);
      const sources = await this.sources(rows);
      const suppliers = rows.map((row) => {
        const source = sources.get(row.id) as SupplierAccountSources & { toPrice: number };
        return {
          supplierId: row.id,
          name: row.name,
          active: row.active,
          ...supplierFigures(source),
          toPrice: source.toPrice,
        };
      });
      const sum = (pick: (account: (typeof suppliers)[number]) => string) =>
        fromCents(suppliers.reduce((total, account) => total + toCents(pick(account)), 0n));
      return {
        currency: await this.calendar.currency(),
        suppliers,
        total: {
          owed: sum((account) => account.owed),
          paid: sum((account) => account.paid),
          outstanding: sum((account) => account.outstanding),
          toPrice: suppliers.reduce((total, account) => total + account.toPrice, 0),
        },
      };
    });
  }

  /** What is still owed to suppliers, clinic-wide (the dashboard's Suppliers line). */
  async outstanding(): Promise<string> {
    return (await this.accounts()).total.outstanding;
  }

  statement(id: string, query: SupplierStatementQuery): Promise<SupplierStatement> {
    this.context.requirePermission('inventory:money_read');
    return this.tenantDb.run(async () => {
      const supplier = await this.require(id);
      const source = (await this.sources([supplier])).get(id) as SupplierAccountSources & {
        toPriceReceipts: SupplierStatement['toPrice'];
      };
      return {
        supplier: { id, name: supplier.name },
        from: query.from,
        to: query.to,
        currency: await this.calendar.currency(),
        ...supplierStatement(source, query.from, query.to),
        toPrice: source.toPriceReceipts,
      };
    });
  }

  async exportStatement(id: string, query: SupplierStatementQuery): Promise<CsvFile> {
    const result = await this.statement(id, query);
    const lang: ExportLanguage = query.lang ?? (await this.tenancy.currentTenant()).locale;
    const labels = INVENTORY_EXPORT_LABELS[lang];
    const header = csvRow([
      labels.statement.date,
      labels.statement.kind,
      labels.statement.receipt,
      labels.statement.description,
      labels.statement.method,
      labels.statement.amount,
      labels.statement.balance,
      labels.statement.status,
    ]);
    const opening = csvRow(
      [query.from, labels.statement.balanceBefore, '', '', '', '', result.balanceBefore, ''],
      { numericColumns: [6] },
    );
    const body = result.lines.map((line) =>
      csvRow(
        [
          line.date,
          labels.kinds[line.kind],
          line.receiptNumber === null ? '' : formatGoodsReceiptNumber(line.receiptNumber),
          line.description ?? '',
          line.method ? labels.methods[line.method] : '',
          line.amount,
          line.balance,
          line.voided ? `${labels.voided} ${line.voidReason ?? ''}`.trim() : '',
        ],
        { numericColumns: [5, 6] },
      ),
    );
    return {
      fileName: `supplier-statement-${query.from}-${query.to}.csv`,
      body: UTF8_BOM + header + opening + body.join(''),
    };
  }

  /** The currency lock: an opening balance, a payment or an adjustment is inventory money. */
  hasMoney(): Promise<boolean> {
    return this.tenantDb.run(() => this.money.anyAccountMoney());
  }

  async require(id: string, lock = false): Promise<StoredSupplier> {
    const row = await this.catalog.supplier(id, lock);
    if (!row) throw new InventoryNotFoundError('No such supplier', { id });
    return row;
  }

  private async insertPayment(
    values: Omit<
      Parameters<MoneyRepository['insertPayment']>[0],
      'currency' | 'createdBy' | 'amount'
    > & { amount: string },
    payee: string,
    branchId: string | null,
  ): Promise<StoredPayment> {
    const row = await this.money.insertPayment({
      ...values,
      amount: fromCents(toCents(values.amount)),
      currency: await this.calendar.currency(),
      createdBy: this.context.requireUserId(),
    });
    await this.audit.record({
      action: 'inventory_payment.record',
      resourceType: 'inventory_payment',
      resourceId: row.id,
      after: {
        payee,
        oneOff: row.supplierId === null,
        amount: row.amount,
        currency: row.currency,
        paidOn: row.paidOn,
        method: row.method,
        reference: row.reference,
      },
    });
    const event: SupplierPaymentRecorded = this.events.create(SUPPLIER_PAYMENT_RECORDED, {
      paymentId: row.id,
      supplierId: row.supplierId,
      payee,
      paidOn: row.paidOn,
      amount: row.amount,
      currency: row.currency,
      method: row.method,
      reference: row.reference,
      note: row.note,
      branchId,
    });
    await this.events.publish(event);
    return row;
  }

  /** Everything an account is computed from, per supplier, and its receipts to price. */
  private async sources(
    rows: readonly StoredSupplier[],
  ): Promise<
    Map<
      string,
      SupplierAccountSources & { toPrice: number; toPriceReceipts: SupplierStatement['toPrice'] }
    >
  > {
    const ids = rows.map((row) => row.id);
    const [receipts, payments, adjustments] = await Promise.all([
      this.stock.supplierReceipts(ids),
      this.money.payments(ids),
      this.money.adjustments(ids),
    ]);
    const batches = await this.stock.batchesOfReceipts(receipts.map((receipt) => receipt.id));
    const result = new Map<
      string,
      SupplierAccountSources & { toPrice: number; toPriceReceipts: SupplierStatement['toPrice'] }
    >();
    for (const supplier of rows) {
      const own = receipts
        .filter((receipt) => receipt.supplierId === supplier.id)
        .map((receipt) => ({
          receipt,
          totals: totalOf(
            receipt,
            batches.filter((batch) => batch.receiptId === receipt.id),
          ),
        }));
      const toPrice = own.filter(({ totals }) => totals === null);
      result.set(supplier.id, {
        supplier: {
          id: supplier.id,
          openingBalance: supplier.openingBalance,
          openingBalanceOn: supplier.openingBalanceOn,
        },
        receipts: own.flatMap(({ receipt, totals }) =>
          totals === null
            ? []
            : [
                {
                  id: receipt.id,
                  number: receipt.displayNumber,
                  receivedOn: receipt.receivedOn,
                  invoiceNumber: receipt.invoiceNumber,
                  total: totals.total,
                },
              ],
        ),
        payments: payments
          .filter((payment) => payment.supplierId === supplier.id)
          .map((payment) => ({
            id: payment.id,
            paidOn: payment.paidOn,
            amount: payment.amount,
            method: payment.method,
            reference: payment.reference,
            voided: payment.voidedAt !== null,
            voidReason: payment.voidReason,
          })),
        adjustments: adjustments
          .filter((adjustment) => adjustment.supplierId === supplier.id)
          .map((adjustment) => ({
            id: adjustment.id,
            onDate: adjustment.onDate,
            kind: adjustment.kind,
            amount: adjustment.amount,
            reason: adjustment.reason,
          })),
        toPrice: toPrice.length,
        toPriceReceipts: toPrice.map(({ receipt }) => ({
          id: receipt.id,
          number: receipt.displayNumber,
          receivedOn: receipt.receivedOn,
          invoiceNumber: receipt.invoiceNumber,
        })),
      });
    }
    return result;
  }

  private nameTaken(name: string): InventoryNameTakenError {
    return new InventoryNameTakenError('Another supplier has this name', { name });
  }

  private mismatch(): InventoryIdempotencyMismatchError {
    return new InventoryIdempotencyMismatchError(
      'This Idempotency-Key was used for a different request',
    );
  }
}
