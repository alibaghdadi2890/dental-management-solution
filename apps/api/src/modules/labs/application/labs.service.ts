import {
  type CreateLab,
  type CreateLabService,
  type ExportLanguage,
  fromCents,
  type Lab,
  type LabAccounts,
  type LabAdjustment,
  type LabListQuery,
  type LabOpeningBalance,
  type LabPayment,
  type LabService,
  type LabStatement,
  type LabStatementQuery,
  type RecordLabAdjustment,
  type RecordLabPayment,
  toCents,
  type UpdateLab,
  type UpdateLabService,
  type VoidLabPayment,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import { csvRow, UTF8_BOM } from '../../../platform/kernel/csv';
import { requestHash } from '../../../platform/kernel/request-hash';
import { AuditService } from '../../audit';
import { PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { type AccountSources, accountFigures, statement } from '../domain/lab-account';
import {
  LabIdempotencyMismatchError,
  LabNameTakenError,
  LabNotFoundError,
  LabPaymentNotFoundError,
  LabPaymentVoidedError,
  LabServiceNameTakenError,
  LabServiceNotFoundError,
} from '../domain/lab-errors';
import {
  LAB_PAYMENT_RECORDED,
  LAB_PAYMENT_VOIDED,
  type LabPaymentRecorded,
  type LabPaymentVoided,
} from '../events/lab-events';
import { LabsRepository, type StoredLab } from '../persistence/labs.repository';
import { OrdersRepository } from '../persistence/orders.repository';
import { LAB_EXPORT_LABELS } from './export-labels';
import { LabCalendar } from './lab-calendar';
import { itemsText, toAdjustment, toLab, toPayment } from './presenter';

/** A CSV export, built in memory: one lab's statement for a period. */
export interface CsvFile {
  fileName: string;
  body: string;
}

const LAB_FIELDS = [
  'name',
  'contactPerson',
  'phone',
  'email',
  'address',
  'deliveryMethods',
  'portalUrl',
  'turnaroundDays',
  'note',
  'active',
] as const;

/**
 * The labs a clinic works with, their price lists and their accounts (feature 18, Parts A and D;
 * docs/modules/labs.md). The directory reads need `lab:read` (prices only with `lab:money_read`);
 * registering labs and everything about money needs `lab:money_manage`, reading money
 * `lab:money_read` (ADR-0086). The account is computed from what is recorded (ADR-0083); each
 * payment is mirrored into Expenses through `LabPaymentRecorded` (ADR-0085).
 */
@Injectable()
export class LabsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly calendar: LabCalendar,
    private readonly tenancy: TenancyService,
    private readonly patients: PatientsService,
    private readonly labs: LabsRepository,
    private readonly orders: OrdersRepository,
  ) {}

  // --- Directory ---

  list(query: LabListQuery = {}): Promise<Lab[]> {
    this.context.requirePermission('lab:read');
    return this.tenantDb.run(async () => {
      const rows = await this.labs.list(query.includeInactive ?? false);
      const services = await this.labs.services(rows.map((row) => row.id));
      const money = this.withMoney();
      return rows.map((row) =>
        toLab(
          row,
          services.filter((service) => service.labId === row.id),
          money,
        ),
      );
    });
  }

  create(input: CreateLab): Promise<Lab> {
    this.context.requirePermission('lab:money_manage');
    return this.tenantDb.run(async () => {
      if (await this.labs.nameTaken(input.name)) throw this.nameTaken(input.name);
      const row = await this.labs.insert({
        ...input,
        currency: await this.calendar.currency(),
        createdBy: this.context.requireUserId(),
      });
      await this.audit.record({
        action: 'lab.create',
        resourceType: 'lab',
        resourceId: row.id,
        after: { name: row.name, turnaroundDays: row.turnaroundDays },
      });
      return toLab(row, [], true);
    });
  }

  update(id: string, patch: UpdateLab): Promise<Lab> {
    this.context.requirePermission('lab:money_manage');
    return this.tenantDb.run(async () => {
      const before = await this.requireLab(id, true);
      const changed: Record<string, unknown> = {};
      for (const field of LAB_FIELDS) {
        const value = patch[field];
        if (value !== undefined && JSON.stringify(value) !== JSON.stringify(before[field])) {
          changed[field] = value;
        }
      }
      if (typeof changed.name === 'string' && (await this.labs.nameTaken(changed.name, id))) {
        throw this.nameTaken(changed.name);
      }
      const row = Object.keys(changed).length === 0 ? before : await this.labs.update(id, changed);
      if (Object.keys(changed).length > 0) {
        const record = before as unknown as Record<string, unknown>;
        await this.audit.record({
          action: 'lab.update',
          resourceType: 'lab',
          resourceId: id,
          before: {
            name: before.name,
            ...Object.fromEntries(Object.keys(changed).map((field) => [field, record[field]])),
          },
          after: { name: row.name, ...changed },
        });
      }
      return toLab(row, await this.labs.services([id]), true);
    });
  }

  createService(labId: string, input: CreateLabService): Promise<LabService> {
    this.context.requirePermission('lab:money_manage');
    return this.tenantDb.run(async () => {
      const lab = await this.requireLab(labId, true);
      if (await this.labs.serviceNameTaken(labId, input.name)) throw this.serviceNameTaken();
      const row = await this.labs.insertService({
        labId,
        name: input.name,
        price: fromCents(toCents(input.price)),
        currency: lab.currency,
        turnaroundDays: input.turnaroundDays,
        createdBy: this.context.requireUserId(),
      });
      await this.audit.record({
        action: 'lab_service.create',
        resourceType: 'lab_service',
        resourceId: row.id,
        after: {
          labName: lab.name,
          name: row.name,
          price: row.price,
          currency: row.currency,
          turnaroundDays: row.turnaroundDays,
        },
      });
      return toLab(lab, [row], true).services[0] as LabService;
    });
  }

  updateService(labId: string, serviceId: string, patch: UpdateLabService): Promise<LabService> {
    this.context.requirePermission('lab:money_manage');
    return this.tenantDb.run(async () => {
      const lab = await this.requireLab(labId, true);
      const [before] = await this.labs.servicesByIds([serviceId]);
      if (!before || before.labId !== labId) {
        throw new LabServiceNotFoundError('No such service', { serviceId });
      }
      const changed: Record<string, unknown> = {};
      if (patch.name !== undefined && patch.name !== before.name) changed.name = patch.name;
      if (patch.price !== undefined && toCents(patch.price) !== toCents(before.price)) {
        changed.price = fromCents(toCents(patch.price));
      }
      if (patch.turnaroundDays !== undefined && patch.turnaroundDays !== before.turnaroundDays) {
        changed.turnaroundDays = patch.turnaroundDays;
      }
      if (patch.active !== undefined && patch.active !== before.active)
        changed.active = patch.active;
      if (
        typeof changed.name === 'string' &&
        (await this.labs.serviceNameTaken(labId, changed.name, serviceId))
      ) {
        throw this.serviceNameTaken();
      }
      if (Object.keys(changed).length === 0)
        return toLab(lab, [before], true).services[0] as LabService;
      const row = await this.labs.updateService(serviceId, changed);
      const record = before as unknown as Record<string, unknown>;
      await this.audit.record({
        action: 'lab_service.update',
        resourceType: 'lab_service',
        resourceId: serviceId,
        before: {
          labName: lab.name,
          name: before.name,
          ...Object.fromEntries(Object.keys(changed).map((field) => [field, record[field]])),
        },
        after: { labName: lab.name, name: row.name, currency: row.currency, ...changed },
      });
      return toLab(lab, [row], true).services[0] as LabService;
    });
  }

  // --- Money ---

  /** A replace: the same request again changes nothing, so a retry never duplicates. */
  setOpeningBalance(labId: string, input: LabOpeningBalance): Promise<Lab> {
    this.context.requirePermission('lab:money_manage');
    return this.tenantDb.run(async () => {
      const before = await this.requireLab(labId, true);
      await this.calendar.assertNotFuture(input.asOf);
      const amount = fromCents(toCents(input.amount));
      const row = await this.labs.update(labId, {
        openingBalance: amount,
        openingBalanceOn: input.asOf,
      });
      if (before.openingBalance !== amount || before.openingBalanceOn !== input.asOf) {
        await this.audit.record({
          action: 'lab.opening_balance',
          resourceType: 'lab',
          resourceId: labId,
          before: {
            name: before.name,
            amount: before.openingBalance,
            asOf: before.openingBalanceOn,
          },
          after: { name: row.name, amount, asOf: input.asOf, currency: row.currency },
        });
      }
      return toLab(row, await this.labs.services([labId]), true);
    });
  }

  recordPayment(labId: string, input: RecordLabPayment, key: string): Promise<LabPayment> {
    this.context.requirePermission('lab:money_manage');
    return this.tenantDb.run(async () => {
      const hash = requestHash({ labId, payment: input });
      await this.labs.lockKey('payment', key);
      const first = await this.labs.paymentByKey(key);
      if (first) {
        if (first.idempotencyHash !== hash) throw this.mismatch();
        return toPayment(first);
      }
      const lab = await this.requireLab(labId, true);
      await this.calendar.assertNotFuture(input.paidOn);
      const row = await this.labs.insertPayment({
        labId,
        paidOn: input.paidOn,
        amount: fromCents(toCents(input.amount)),
        currency: lab.currency,
        method: input.method,
        reference: input.reference,
        note: input.note,
        createdBy: this.context.requireUserId(),
        idempotencyKey: key,
        idempotencyHash: hash,
      });
      await this.audit.record({
        action: 'lab_payment.record',
        resourceType: 'lab_payment',
        resourceId: row.id,
        after: {
          labName: lab.name,
          amount: row.amount,
          currency: row.currency,
          paidOn: row.paidOn,
          method: row.method,
          reference: row.reference,
        },
      });
      const event: LabPaymentRecorded = this.events.create(LAB_PAYMENT_RECORDED, {
        paymentId: row.id,
        labId,
        labName: lab.name,
        paidOn: row.paidOn,
        amount: row.amount,
        currency: row.currency,
        method: row.method,
        reference: row.reference,
        note: row.note,
      });
      await this.events.publish(event);
      return toPayment(row);
    });
  }

  /** Stays visible, struck through; its Expenses row is voided in the same transaction. */
  voidPayment(paymentId: string, input: VoidLabPayment): Promise<LabPayment> {
    this.context.requirePermission('lab:money_manage');
    return this.tenantDb.run(async () => {
      const before = await this.labs.lockPayment(paymentId);
      if (!before) throw new LabPaymentNotFoundError('No such payment', { paymentId });
      if (before.voidedAt !== null) throw new LabPaymentVoidedError('This payment is voided');
      const lab = await this.requireLab(before.labId, false);
      const row = await this.labs.voidPayment(paymentId, {
        at: this.calendar.now(),
        by: this.context.requireUserId(),
        reason: input.reason,
      });
      await this.audit.record({
        action: 'lab_payment.void',
        resourceType: 'lab_payment',
        resourceId: paymentId,
        before: { voided: false },
        after: {
          voided: true,
          labName: lab.name,
          amount: row.amount,
          currency: row.currency,
          paidOn: row.paidOn,
        },
        reason: input.reason,
      });
      const event: LabPaymentVoided = this.events.create(LAB_PAYMENT_VOIDED, {
        paymentId,
        labId: row.labId,
        reason: input.reason,
      });
      await this.events.publish(event);
      return toPayment(row);
    });
  }

  recordAdjustment(labId: string, input: RecordLabAdjustment, key: string): Promise<LabAdjustment> {
    this.context.requirePermission('lab:money_manage');
    return this.tenantDb.run(async () => {
      const hash = requestHash({ labId, adjustment: input });
      await this.labs.lockKey('adjustment', key);
      const first = await this.labs.adjustmentByKey(key);
      if (first) {
        if (first.idempotencyHash !== hash) throw this.mismatch();
        return toAdjustment(first);
      }
      const lab = await this.requireLab(labId, true);
      await this.calendar.assertNotFuture(input.onDate);
      const row = await this.labs.insertAdjustment({
        labId,
        onDate: input.onDate,
        kind: input.kind,
        amount: fromCents(toCents(input.amount)),
        currency: lab.currency,
        reason: input.reason,
        createdBy: this.context.requireUserId(),
        idempotencyKey: key,
        idempotencyHash: hash,
      });
      await this.audit.record({
        action: 'lab_adjustment.record',
        resourceType: 'lab_adjustment',
        resourceId: row.id,
        after: {
          labName: lab.name,
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

  /** Every lab's outstanding and in-progress amounts, and the clinic's totals. */
  accounts(): Promise<LabAccounts> {
    this.context.requirePermission('lab:money_read');
    return this.tenantDb.run(async () => {
      const rows = await this.labs.list(true);
      const sources = await this.sources(rows);
      const labs = rows.map((row) => {
        const figures = accountFigures(sources.get(row.id) as AccountSources);
        return { labId: row.id, labName: row.name, active: row.active, ...figures };
      });
      const sum = (pick: (lab: (typeof labs)[number]) => string) =>
        fromCents(labs.reduce((total, lab) => total + toCents(pick(lab)), 0n));
      return {
        currency: await this.calendar.currency(),
        labs,
        total: {
          owed: sum((lab) => lab.owed),
          paid: sum((lab) => lab.paid),
          outstanding: sum((lab) => lab.outstanding),
          inProgressCount: labs.reduce((total, lab) => total + lab.inProgressCount, 0),
          inProgressAmount: sum((lab) => lab.inProgressAmount),
        },
      };
    });
  }

  statement(labId: string, query: LabStatementQuery): Promise<LabStatement> {
    this.context.requirePermission('lab:money_read');
    return this.tenantDb.run(async () => {
      const lab = await this.requireLab(labId, false);
      const sources = (await this.sources([lab])).get(labId) as AccountSources;
      const result = statement(sources, query.from, query.to);
      return {
        lab: { id: lab.id, name: lab.name },
        from: query.from,
        to: query.to,
        currency: lab.currency,
        ...result,
      };
    });
  }

  async exportStatement(labId: string, query: LabStatementQuery): Promise<CsvFile> {
    const result = await this.statement(labId, query);
    const lang: ExportLanguage = query.lang ?? (await this.tenancy.currentTenant()).locale;
    const labels = LAB_EXPORT_LABELS[lang];
    const header = csvRow([
      labels.statement.date,
      labels.statement.kind,
      labels.statement.order,
      labels.statement.patient,
      labels.statement.description,
      labels.statement.method,
      labels.statement.amount,
      labels.statement.balance,
      labels.statement.status,
    ]);
    const opening = csvRow(
      [query.from, labels.statement.balanceBefore, '', '', '', '', '', result.balanceBefore, ''],
      { numericColumns: [7] },
    );
    const body = result.lines.map((line) =>
      csvRow(
        [
          line.date,
          labels.kinds[line.kind],
          line.orderNumber === null ? '' : `L-${String(line.orderNumber).padStart(6, '0')}`,
          line.patientName ?? '',
          line.description ?? '',
          line.method ? labels.methods[line.method] : '',
          line.amount,
          line.balance,
          line.voided ? `${labels.voided} ${line.voidReason ?? ''}`.trim() : '',
        ],
        { numericColumns: [6, 7] },
      ),
    );
    return {
      fileName: `lab-statement-${query.from}-${query.to}.csv`,
      body: UTF8_BOM + header + opening + body.join(''),
    };
  }

  /** The currency lock (ADR-0035 extended): any lab money keeps the clinic's currency. */
  hasMoney(): Promise<boolean> {
    return this.tenantDb.run(() => this.labs.anyMoney());
  }

  /** Everything an account is computed from, per lab. */
  private async sources(rows: readonly StoredLab[]): Promise<Map<string, AccountSources>> {
    const ids = rows.map((row) => row.id);
    const orders = await this.orders.forLabs(ids);
    const orderIds = orders.map((order) => order.id);
    const [items, trips, payments, adjustments, patients] = await Promise.all([
      this.orders.items(orderIds),
      this.orders.trips(orderIds),
      this.labs.payments(ids),
      this.labs.adjustments(ids),
      this.patients.refs([...new Set(orders.map((order) => order.patientId))]),
    ]);
    const names = new Map(patients.map((patient) => [patient.id, patient.fullName] as const));
    const result = new Map<string, AccountSources>();
    for (const lab of rows) {
      result.set(lab.id, {
        lab: {
          id: lab.id,
          openingBalance: lab.openingBalance,
          openingBalanceOn: lab.openingBalanceOn,
        },
        orders: orders
          .filter((order) => order.labId === lab.id)
          .map((order) => {
            const own = trips.filter((trip) => trip.orderId === order.id);
            return {
              id: order.id,
              displayNumber: order.displayNumber,
              patientName: names.get(order.patientId) ?? '',
              items: itemsText(items.filter((item) => item.orderId === order.id)),
              cost: order.cost,
              firstReceivedOn: order.firstReceivedOn,
              cancelledOn: order.status === 'cancelled' ? order.cancelledOn : null,
              cancelCharge: order.status === 'cancelled' ? order.cancelCharge : null,
              hasTrip: own.length > 0,
              remakeCharges: own.flatMap((trip) =>
                trip.remakeCharge !== null &&
                trip.outcomeOn !== null &&
                toCents(trip.remakeCharge) > 0n
                  ? [{ tripId: trip.id, on: trip.outcomeOn, charge: trip.remakeCharge }]
                  : [],
              ),
            };
          }),
        payments: payments
          .filter((payment) => payment.labId === lab.id)
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
          .filter((adjustment) => adjustment.labId === lab.id)
          .map((adjustment) => ({
            id: adjustment.id,
            onDate: adjustment.onDate,
            kind: adjustment.kind,
            amount: adjustment.amount,
            reason: adjustment.reason,
          })),
      });
    }
    return result;
  }

  private withMoney(): boolean {
    return this.context.hasPermission('lab:money_read');
  }

  private async requireLab(id: string, lock: boolean): Promise<StoredLab> {
    const row = lock ? await this.labs.lock(id) : await this.labs.byId(id);
    if (!row) throw new LabNotFoundError('No such lab', { id });
    return row;
  }

  private nameTaken(name: string): LabNameTakenError {
    return new LabNameTakenError('Another lab has this name', { name });
  }

  private serviceNameTaken(): LabServiceNameTakenError {
    return new LabServiceNameTakenError('This lab already has a service with this name');
  }

  private mismatch(): LabIdempotencyMismatchError {
    return new LabIdempotencyMismatchError('This Idempotency-Key was used for a different request');
  }
}
