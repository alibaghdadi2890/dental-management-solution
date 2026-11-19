import {
  type EditReceipt,
  lineAmount,
  type PriceReceipt,
  type PricePer,
  parseGoodsReceiptNumber,
  RECEIPT_FILES_MAX,
  type Receive,
  type ReceiptLineInput,
  type ReceiptListQuery,
  type ReceiptPage,
  type ReceiptUploadIntent,
  type ReceiptUploadTargets,
  type StockReceipt,
} from '@dcm/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { newId } from '../../../platform/kernel/id';
import { requestHash } from '../../../platform/kernel/request-hash';
import { CONTENT_HEAD_BYTES, contentMatches } from '../../../platform/storage/content-check';
import { ObjectStorage } from '../../../platform/storage/object-storage';
import { AuditService } from '../../audit';
import { UsersService } from '../../users';
import {
  DuplicateInvoiceError,
  ExpiryRequiredError,
  InventoryIdempotencyMismatchError,
  InventoryInactiveError,
  InventoryNotFoundError,
  OneOffLockedError,
  ReceiptFileError,
  ReceiptTotalError,
  ReceiptTouchedError,
  ReceiptUnpricedError,
  ReceiptVoidedError,
} from '../domain/inventory-errors';
import { CatalogRepository, type StoredItem } from '../persistence/catalog.repository';
import { MoneyRepository } from '../persistence/money.repository';
import {
  type StoredBatch,
  type StoredReceipt,
  StockRepository,
} from '../persistence/stock.repository';
import { InventoryCalendar } from './inventory-calendar';
import { MovementWriter } from './movement-writer';
import { toReceipt, toReceiptSummary, totalOf } from './presenter';
import { SuppliersService } from './suppliers.service';

const MAX_RECEIPT_FILE_BYTES = 25 * 1024 * 1024;
const UPLOAD_URL_SECONDS = 15 * 60;
const READ_URL_SECONDS = 5 * 60;

const priced = (line: { price: string | null }) => line.price !== null;

/**
 * Deliveries received (feature 20a, B1; docs/modules/inventory.md). Receiving needs
 * `inventory:write` and puts the stock on hand at once; a price, a discount, the charges, _Paid
 * now_ and a one-off purchase need `inventory:money_manage`; editing and voiding
 * `inventory:manage`. `receive` takes the whole receipt as one input and returns plain data
 * (D12). Attachments follow the patient files' mechanics without being patient files (ADR-0100).
 */
@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly calendar: InventoryCalendar,
    private readonly catalog: CatalogRepository,
    private readonly stock: StockRepository,
    private readonly money: MoneyRepository,
    private readonly writer: MovementWriter,
    private readonly suppliers: SuppliersService,
    private readonly users: UsersService,
    private readonly storage: ObjectStorage,
  ) {}

  /** `POST /inventory/receipts` (Idempotency-Key): a retry with the same key returns it. */
  receive(input: Receive, key: string): Promise<StockReceipt> {
    this.context.requirePermission('inventory:write');
    const oneOff = input.supplierId === null;
    if (
      oneOff ||
      input.lines.some(priced) ||
      input.discount !== null ||
      input.charges !== null ||
      input.paidNow !== null
    ) {
      this.context.requirePermission('inventory:money_manage');
    }
    return this.tenantDb.run(async () => {
      const hash = requestHash({ receive: input });
      await this.catalog.lockKey('receipt', key);
      const first = await this.stock.receiptByKey(key);
      if (first) {
        if (first.idempotencyHash !== hash) throw this.mismatch();
        return this.read(first.id);
      }
      await this.calendar.assertNotFuture(input.receivedOn);
      await this.calendar.assertNotFuture(input.invoiceDate);
      await this.calendar.assertBranch(input.branchId);
      const supplier = input.supplierId ? await this.suppliers.require(input.supplierId) : null;
      if (supplier && !supplier.active) {
        throw new InventoryInactiveError('This supplier is inactive');
      }
      const items = await this.requireItems(input.lines);
      const allPriced = input.lines.every(priced);
      if ((oneOff || input.paidNow !== null) && !allPriced) {
        throw new ReceiptUnpricedError('Price every line to pay this receipt now');
      }
      if (oneOff && input.paidNow === null) {
        throw new ReceiptUnpricedError('A one-off purchase is paid when it is recorded');
      }
      if (supplier && input.invoiceNumber !== null && !input.allowDuplicateInvoice) {
        // Two receipts of the same invoice at once: the second waits and sees the first.
        await this.catalog.lockKey(
          'invoice',
          `${supplier.id}:${input.invoiceNumber.trim().toLocaleLowerCase()}`,
        );
        const same = await this.stock.sameInvoice(supplier.id, input.invoiceNumber);
        if (same) throw new DuplicateInvoiceError(same.id, same.displayNumber);
      }
      const receipt = await this.stock.insertReceipt({
        displayNumber: await this.stock.nextReceiptNumber(),
        supplierId: supplier?.id ?? null,
        payee: input.payee,
        branchId: input.branchId,
        receivedOn: input.receivedOn,
        invoiceNumber: input.invoiceNumber,
        invoiceDate: input.invoiceDate,
        discount: input.discount,
        charges: input.charges,
        currency: await this.calendar.currency(),
        note: input.note,
        createdBy: this.context.requireUserId(),
        idempotencyKey: key,
        idempotencyHash: hash,
      });
      const batches = await this.addLines(receipt, input.lines, items, 0);
      await this.catalog.clearOrdered(
        [...new Set(input.lines.map((line) => line.itemId))],
        input.branchId,
      );
      await this.audit.record({
        action: 'inventory_receipt.receive',
        resourceType: 'inventory_receipt',
        resourceId: receipt.id,
        after: {
          number: receipt.displayNumber,
          supplierName: supplier?.name ?? null,
          payee: receipt.payee,
          invoiceNumber: receipt.invoiceNumber,
          branchId: receipt.branchId,
          lines: input.lines.map((line) => ({
            item: items.get(line.itemId)?.name ?? '',
            quantity: line.quantity,
          })),
        },
      });
      const totals = totalOf(receipt, batches);
      this.assertTotal(totals);
      if (input.lines.some(priced) || input.discount !== null || input.charges !== null) {
        await this.recordPrices(receipt, [], batches, null, totals?.total ?? null);
      }
      if (input.paidNow !== null && totals !== null && totals.total !== '0.00') {
        await this.suppliers.payForReceipt({
          supplier,
          payee: supplier?.name ?? (input.payee as string),
          receiptId: receipt.id,
          branchId: receipt.branchId,
          paidOn: input.paidNow.paidOn,
          amount: totals.total,
          method: input.paidNow.method,
          reference: input.paidNow.reference,
        });
      }
      return this.read(receipt.id);
    });
  }

  get(id: string): Promise<StockReceipt> {
    this.context.requirePermission('inventory:read');
    return this.tenantDb.run(() => this.read(id));
  }

  list(query: ReceiptListQuery): Promise<ReceiptPage> {
    this.context.requirePermission('inventory:read');
    return this.tenantDb.run(async () => {
      const number = query.q ? parseGoodsReceiptNumber(query.q) : null;
      const rows = await this.stock.listReceipts(
        {
          branchId: query.branchId,
          supplierId: query.supplierId,
          from: query.from,
          to: query.to,
          ...(number !== null ? { number } : { q: query.q }),
          before: query.cursor,
        },
        query.toPrice === true,
        query.limit + 1,
      );
      const page = rows.slice(0, query.limit);
      const batches = await this.stock.batchesOfReceipts(page.map((row) => row.id));
      const suppliers = new Map(
        (
          await this.catalog.suppliersByIds([
            ...new Set(page.flatMap((row) => (row.supplierId ? [row.supplierId] : []))),
          ])
        ).map((row) => [row.id, row.name] as const),
      );
      const money = this.context.hasPermission('inventory:money_read');
      return {
        items: page.map((row) =>
          toReceiptSummary(
            row,
            batches.filter((batch) => batch.receiptId === row.id),
            row.supplierId ? (suppliers.get(row.supplierId) ?? null) : null,
            money,
          ),
        ),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
        currency: await this.calendar.currency(),
      };
    });
  }

  /** `PUT /inventory/receipts/:id/prices`: what the lines cost, the discount and the charges. */
  price(id: string, input: PriceReceipt): Promise<StockReceipt> {
    this.context.requirePermission('inventory:money_manage');
    return this.tenantDb.run(async () => {
      const receipt = await this.requireLive(id);
      if (receipt.supplierId === null) {
        throw new OneOffLockedError('A one-off purchase was priced and paid when recorded');
      }
      const batches = await this.stock.lockBatchesOfReceipt(id);
      const before = batches.map((batch) => ({ ...batch }));
      const items = await this.itemMap(batches.map((batch) => batch.itemId));
      const updated = new Map(batches.map((batch) => [batch.id, batch] as const));
      for (const line of input.lines) {
        const batch = updated.get(line.batchId);
        if (!batch) throw new InventoryNotFoundError('No such line', { batchId: line.batchId });
        const item = items.get(batch.itemId) as StoredItem;
        updated.set(
          batch.id,
          await this.stock.updateBatch(batch.id, this.priceOf(line, batch.quantity, item)),
        );
      }
      const after = await this.stock.updateReceipt(id, {
        discount: input.discount,
        charges: input.charges,
      });
      const lines = [...updated.values()];
      const totals = totalOf(after, lines);
      this.assertTotal(totals);
      await this.recordPrices(after, before, lines, receipt, totals?.total ?? null);
      return this.read(id);
    });
  }

  /** Corrects what was received (B1): dates, invoice, note, lots, expiries, quantities, lines. */
  edit(id: string, input: EditReceipt): Promise<StockReceipt> {
    this.context.requirePermission('inventory:manage');
    if (input.addLines.some(priced)) this.context.requirePermission('inventory:money_manage');
    return this.tenantDb.run(async () => {
      const receipt = await this.requireLive(id);
      const oneOff = receipt.supplierId === null;
      if (oneOff && (input.addLines.length > 0 || input.lines.some((l) => l.quantity))) {
        throw new OneOffLockedError('A one-off purchase keeps its lines and quantities');
      }
      await this.calendar.assertNotFuture(input.receivedOn ?? null);
      await this.calendar.assertNotFuture(input.invoiceDate ?? null);
      const batches = await this.stock.lockBatchesOfReceipt(id);
      const items = await this.itemMap([
        ...batches.map((batch) => batch.itemId),
        ...input.addLines.map((line) => line.itemId),
      ]);
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      const patch: Record<string, unknown> = {};
      for (const field of ['receivedOn', 'invoiceNumber', 'invoiceDate', 'note'] as const) {
        const value = input[field];
        if (value !== undefined && value !== receipt[field]) {
          patch[field] = value;
          changes[field] = { before: receipt[field], after: value };
        }
      }
      if (Object.keys(patch).length > 0) await this.stock.updateReceipt(id, patch);
      const lineChanges: Record<string, unknown>[] = [];
      for (const line of input.lines) {
        const batch = batches.find((candidate) => candidate.id === line.batchId);
        if (!batch) throw new InventoryNotFoundError('No such line', { batchId: line.batchId });
        const item = items.get(batch.itemId) as StoredItem;
        const batchPatch: Record<string, unknown> = {};
        if (line.lot !== undefined && line.lot !== batch.lot) batchPatch.lot = line.lot;
        if (line.expiresOn !== undefined && line.expiresOn !== batch.expiresOn) {
          if (line.expiresOn === null && item.tracksExpiry) {
            throw new ExpiryRequiredError('This item tracks expiry: give the date');
          }
          batchPatch.expiresOn = line.expiresOn;
        }
        if (line.quantity !== undefined && line.quantity !== batch.quantity) {
          const gone = batch.quantity - batch.quantityLeft;
          if (line.quantity < gone) {
            throw new ReceiptTouchedError(`${String(gone)} have already left this line`, {
              batchId: batch.id,
            });
          }
          batchPatch.quantity = line.quantity;
          if (batch.price !== null && batch.pricePer !== null) {
            batchPatch.amount = lineAmount(
              batch.price,
              batch.pricePer,
              line.quantity,
              item.packSize,
            );
          }
          await this.writer.write({
            actionId: id,
            kind: 'receipt_edit',
            itemId: batch.itemId,
            branchId: batch.branchId,
            shares: [{ batchId: batch.id, quantity: line.quantity - batch.quantity }],
            receiptId: id,
          });
        }
        if (patch.receivedOn !== undefined) batchPatch.receivedOn = patch.receivedOn;
        if (Object.keys(batchPatch).length > 0) {
          await this.stock.updateBatch(batch.id, batchPatch);
          const { amount: _amount, ...shown } = batchPatch;
          lineChanges.push({
            item: item.name,
            before: Object.fromEntries(
              Object.keys(shown).map((field) => [field, (batch as Record<string, unknown>)[field]]),
            ),
            after: shown,
          });
        }
      }
      if (patch.receivedOn !== undefined) {
        for (const batch of batches.filter((b) => !input.lines.some((l) => l.batchId === b.id))) {
          await this.stock.updateBatch(batch.id, { receivedOn: patch.receivedOn as string });
        }
      }
      const current = (await this.stock.receipt(id)) as StoredReceipt;
      if (input.addLines.length > 0) {
        await this.requireItems(input.addLines, items);
        await this.addLines(current, input.addLines, items, batches.length);
        await this.catalog.clearOrdered(
          [...new Set(input.addLines.map((line) => line.itemId))],
          current.branchId,
        );
      }
      if (Object.keys(changes).length > 0 || lineChanges.length > 0 || input.addLines.length > 0) {
        await this.audit.record({
          action: 'inventory_receipt.edit',
          resourceType: 'inventory_receipt',
          resourceId: id,
          before: {
            number: receipt.displayNumber,
            ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.before])),
          },
          after: {
            number: receipt.displayNumber,
            ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.after])),
            lines: lineChanges,
            added: input.addLines.map((line) => ({
              item: items.get(line.itemId)?.name ?? '',
              quantity: line.quantity,
            })),
          },
        });
      }
      return this.read(id);
    });
  }

  /**
   * Voids a receipt nothing has left (B1): its stock and what was owed for it go; a one-off
   * purchase's payment is voided with it. Payments to an account stay.
   */
  void(id: string, reason: string): Promise<StockReceipt> {
    this.context.requirePermission('inventory:manage');
    return this.tenantDb.run(async () => {
      const receipt = await this.requireLive(id);
      if (receipt.supplierId === null) this.context.requirePermission('inventory:money_manage');
      const batches = await this.stock.lockBatchesOfReceipt(id);
      if (batches.some((batch) => batch.quantityLeft !== batch.quantity)) {
        throw new ReceiptTouchedError('Some of this receipt’s stock has left; it can’t be voided');
      }
      for (const batch of batches) {
        if (batch.quantity === 0) continue;
        await this.writer.write({
          actionId: id,
          kind: 'receipt_void',
          itemId: batch.itemId,
          branchId: batch.branchId,
          shares: [{ batchId: batch.id, quantity: -batch.quantity }],
          receiptId: id,
          note: reason,
        });
      }
      const voided = await this.stock.voidReceipt(
        id,
        this.calendar.now(),
        this.context.requireUserId(),
        reason,
      );
      await this.audit.record({
        action: 'inventory_receipt.void',
        resourceType: 'inventory_receipt',
        resourceId: id,
        before: { voided: false },
        after: { voided: true, number: voided.displayNumber },
        reason,
      });
      if (receipt.supplierId === null) {
        const payment = await this.money.paymentOfReceipt(id);
        if (payment && payment.voidedAt === null) {
          await this.suppliers.voidPaymentRow(payment.id, reason);
        }
      }
      return this.read(id);
    });
  }

  // --- Attachments (ADR-0100) ---

  requestUploads(receiptId: string, input: ReceiptUploadIntent): Promise<ReceiptUploadTargets> {
    this.context.requirePermission('inventory:write');
    return this.tenantDb.run(async () => {
      await this.requireLive(receiptId);
      const saved = await this.money.files([receiptId]);
      if (saved.length + input.files.length > RECEIPT_FILES_MAX) {
        throw new ReceiptFileError(`A receipt keeps at most ${String(RECEIPT_FILES_MAX)} files`);
      }
      const uploadedBy = this.context.requireUserId();
      const rows = input.files.map((file) => {
        const id = newId();
        return {
          id,
          receiptId,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          storageKey: this.storage.tenantKey('inventory', 'uploads', id),
          uploadedBy,
        };
      });
      await this.money.insertFiles(rows);
      return {
        uploads: await Promise.all(
          rows.map(async (row) => ({
            id: row.id,
            mimeType: row.mimeType,
            url: await this.storage.presignUpload({
              key: row.storageKey,
              contentType: row.mimeType,
              expiresInSeconds: UPLOAD_URL_SECONDS,
            }),
          })),
        ),
      };
    });
  }

  /**
   * Seals uploaded files onto the receipt: each is copied inside the store to its own key, then
   * the copy is checked (there, within the size limit, the bytes of its type). Outside the
   * transaction, like a patient file's Save; a failed check removes the copy.
   */
  async saveFiles(receiptId: string, ids: readonly string[]): Promise<StockReceipt> {
    this.context.requirePermission('inventory:write');
    const me = this.context.requireUserId();
    const pending = await this.tenantDb.run(async () =>
      (await this.money.filesByIds(ids)).filter(
        (file) => file.receiptId === receiptId && file.savedAt === null && file.uploadedBy === me,
      ),
    );
    if (pending.length !== new Set(ids).size) {
      throw new ReceiptFileError('This upload is not there');
    }
    const sealed: { id: string; key: string; sizeBytes: number; upload: string }[] = [];
    try {
      for (const file of pending) {
        const key = this.storage.tenantKey('inventory', 'receipts', receiptId, file.id);
        sealed.push({ id: file.id, key, sizeBytes: 0, upload: file.storageKey });
        if (!(await this.storage.copy(file.storageKey, key))) {
          throw new ReceiptFileError('This file has not finished uploading');
        }
        const object = await this.storage.head(key);
        if (!object || object.sizeBytes === 0 || object.sizeBytes > MAX_RECEIPT_FILE_BYTES) {
          throw new ReceiptFileError('This file is empty or too large');
        }
        const start = await this.storage.readStart(key, CONTENT_HEAD_BYTES);
        if (!start || !contentMatches(file.mimeType, start)) {
          throw new ReceiptFileError('This file is not the type its name says');
        }
        (sealed.at(-1) as { sizeBytes: number }).sizeBytes = object.sizeBytes;
      }
    } catch (error) {
      await this.bestEffortRemove(sealed.map((file) => file.key));
      throw error;
    }
    const result = await this.tenantDb.run(async () => {
      await this.requireLive(receiptId);
      const saved = await this.money.files([receiptId]);
      if (saved.length + sealed.length > RECEIPT_FILES_MAX) {
        throw new ReceiptFileError(`A receipt keeps at most ${String(RECEIPT_FILES_MAX)} files`);
      }
      const at = this.calendar.now();
      for (const file of sealed) await this.money.saveFile(file.id, file.key, file.sizeBytes, at);
      await this.audit.record({
        action: 'inventory_receipt.attach',
        resourceType: 'inventory_receipt',
        resourceId: receiptId,
        after: { files: pending.map((file) => file.filename) },
      });
      return this.read(receiptId);
    });
    await this.bestEffortRemove(sealed.map((file) => file.upload));
    return result;
  }

  /** A short-lived link to open an attachment: it is inventory money (Access). */
  fileUrl(receiptId: string, fileId: string): Promise<{ url: string }> {
    this.context.requirePermission('inventory:money_read');
    return this.tenantDb.run(async () => {
      const [file] = (await this.money.files([receiptId])).filter((row) => row.id === fileId);
      if (!file) throw new InventoryNotFoundError('No such file', { fileId });
      return {
        url: await this.storage.presignDownload({
          key: file.storageKey,
          expiresInSeconds: READ_URL_SECONDS,
          contentType: file.mimeType,
          disposition: { type: 'inline', filename: file.filename },
        }),
      };
    });
  }

  async removeFile(receiptId: string, fileId: string): Promise<StockReceipt> {
    this.context.requirePermission('inventory:money_manage');
    const { result, key } = await this.tenantDb.run(async () => {
      const [file] = (await this.money.files([receiptId])).filter((row) => row.id === fileId);
      if (!file) throw new InventoryNotFoundError('No such file', { fileId });
      await this.money.deleteFiles([file.id]);
      await this.audit.record({
        action: 'inventory_receipt.detach',
        resourceType: 'inventory_receipt',
        resourceId: receiptId,
        before: { files: [file.filename] },
      });
      return { result: await this.read(receiptId), key: file.storageKey };
    });
    await this.bestEffortRemove([key]);
    return result;
  }

  // --- Helpers ---

  /** The receipt as its caller may see it. */
  async read(id: string): Promise<StockReceipt> {
    const receipt = await this.stock.receipt(id);
    if (!receipt) throw new InventoryNotFoundError('No such receipt', { id });
    const batches = await this.stock.batchesOfReceipts([id]);
    const [items, supplier, files, payment, names] = await Promise.all([
      this.itemMap(batches.map((batch) => batch.itemId)),
      receipt.supplierId ? this.catalog.supplier(receipt.supplierId) : Promise.resolve(undefined),
      this.money.files([id]),
      receipt.supplierId === null ? this.money.paymentOfReceipt(id) : Promise.resolve(undefined),
      this.users.namesByUserIds([receipt.createdBy]),
    ]);
    return toReceipt(receipt, batches, {
      supplierName: supplier?.name ?? null,
      items,
      files,
      paymentId: payment?.id ?? null,
      createdByName: names.get(receipt.createdBy) ?? null,
      money: this.context.hasPermission('inventory:money_read'),
    });
  }

  /** One batch and one `receive` movement per line (B1, B2): the stock is on hand at once. */
  private async addLines(
    receipt: StoredReceipt,
    lines: readonly ReceiptLineInput[],
    items: ReadonlyMap<string, StoredItem>,
    from: number,
  ): Promise<StoredBatch[]> {
    const batches: StoredBatch[] = [];
    for (const [index, line] of lines.entries()) {
      const item = items.get(line.itemId) as StoredItem;
      const batch = await this.stock.insertBatch({
        itemId: item.id,
        branchId: receipt.branchId,
        source: 'receipt',
        receiptId: receipt.id,
        position: from + index,
        lot: line.lot,
        expiresOn: line.expiresOn,
        receivedOn: receipt.receivedOn,
        quantity: line.quantity,
        quantityLeft: 0,
        ...(line.price === null
          ? { price: null, pricePer: null, amount: null }
          : this.priceOf({ price: line.price, pricePer: line.pricePer }, line.quantity, item)),
        currency: receipt.currency,
      });
      await this.writer.write({
        actionId: receipt.id,
        kind: 'receive',
        itemId: item.id,
        branchId: receipt.branchId,
        shares: [{ batchId: batch.id, quantity: line.quantity }],
        receiptId: receipt.id,
      });
      batches.push({ ...batch, quantityLeft: line.quantity });
    }
    return batches;
  }

  private assertTotal(totals: { total: string } | null): void {
    if (totals !== null && totals.total.startsWith('-')) {
      throw new ReceiptTotalError('The discount is more than the receipt');
    }
  }

  private priceOf(
    line: { price: string; pricePer: PricePer },
    quantity: number,
    item: StoredItem,
  ): { price: string; pricePer: PricePer; amount: string } {
    // Per pack needs a pack: an item without one is priced per unit.
    const pricePer = item.packSize === null ? 'unit' : line.pricePer;
    return {
      price: line.price,
      pricePer,
      amount: lineAmount(line.price, pricePer, quantity, item.packSize),
    };
  }

  /** The money row of a receipt (hidden without `inventory:money_read`). */
  private async recordPrices(
    receipt: StoredReceipt,
    before: readonly StoredBatch[],
    after: readonly StoredBatch[],
    receiptBefore: StoredReceipt | null,
    total: string | null,
  ): Promise<void> {
    const prices = (rows: readonly StoredBatch[]) =>
      rows.map((batch) => ({
        batchId: batch.id,
        price: batch.price,
        pricePer: batch.pricePer,
        amount: batch.amount,
      }));
    await this.audit.record({
      action: 'inventory_receipt.price',
      resourceType: 'inventory_receipt',
      resourceId: receipt.id,
      before:
        receiptBefore === null
          ? undefined
          : {
              number: receipt.displayNumber,
              lines: prices(before),
              discount: receiptBefore.discount,
              charges: receiptBefore.charges,
            },
      after: {
        number: receipt.displayNumber,
        lines: prices(after),
        discount: receipt.discount,
        charges: receipt.charges,
        total,
        currency: receipt.currency,
      },
    });
  }

  private async requireItems(
    lines: readonly ReceiptLineInput[],
    known?: ReadonlyMap<string, StoredItem>,
  ): Promise<Map<string, StoredItem>> {
    const items = new Map(known ?? (await this.itemMap(lines.map((line) => line.itemId))));
    for (const line of lines) {
      const item = items.get(line.itemId);
      if (!item) throw new InventoryNotFoundError('No such item', { itemId: line.itemId });
      if (!item.active) throw new InventoryInactiveError(`${item.name} is inactive`);
      if (item.tracksExpiry && line.expiresOn === null) {
        throw new ExpiryRequiredError(`${item.name} tracks expiry: give the date`, {
          itemId: item.id,
        });
      }
    }
    return items;
  }

  private async itemMap(ids: readonly string[]): Promise<Map<string, StoredItem>> {
    return new Map(
      (await this.catalog.itemsByIds([...new Set(ids)])).map((item) => [item.id, item] as const),
    );
  }

  private async requireLive(id: string): Promise<StoredReceipt> {
    const receipt = await this.stock.receipt(id, true);
    if (!receipt) throw new InventoryNotFoundError('No such receipt', { id });
    if (receipt.voidedAt !== null) throw new ReceiptVoidedError('This receipt is voided');
    return receipt;
  }

  private async bestEffortRemove(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.storage.remove(keys);
    } catch (error) {
      this.logger.warn({ err: error, count: keys.length }, 'removing receipt objects failed');
    }
  }

  private mismatch(): InventoryIdempotencyMismatchError {
    return new InventoryIdempotencyMismatchError(
      'This Idempotency-Key was used for a different request',
    );
  }
}
