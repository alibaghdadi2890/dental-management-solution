import {
  fromCents,
  type PaymentInput,
  type PaymentPreview,
  type RecordPaymentResult,
  type RefundInput,
  type Tenant,
  toCents,
  type PaymentWriteResult,
  type VoidPaymentInput,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import type { Clock } from '../../../platform/kernel/clock';
import { newId } from '../../../platform/kernel/id';
import { localDate } from '../../../platform/kernel/local-date';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import { AuditService } from '../../audit';
import { ContactsService, PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import {
  type NewAllocation,
  outstandingByTarget,
  type PlannedAllocation,
  planPayment,
  refundReleases,
} from '../domain/allocate';
import type { AccountTarget, Payment } from '../domain/payment';
import {
  IdempotencyMismatchError,
  NothingOutstandingError,
  OverRefundError,
  PayerNotBillingContactError,
  PaymentHasRefundsError,
  PaymentNotFoundError,
  PaymentNotReversibleError,
  PaymentOverOutstandingError,
  PaymentTargetInvalidError,
} from '../domain/payment-errors';
import {
  PAYMENT_RECORDED,
  PAYMENT_REFUNDED,
  PAYMENT_VOIDED,
  type PaymentRecorded,
  type PaymentRefunded,
  type PaymentVoided,
} from '../events/payment-events';
import { AllocationsRepository } from '../persistence/allocations.repository';
import { LedgerEntriesRepository } from '../persistence/ledger-entries.repository';
import { PaymentsRepository } from '../persistence/payments.repository';
import { ChargeLabels } from './charge-labels';
import { LedgerWriter } from './ledger-writer';
import { type AccountState, Settlement, toFact } from './settlement';

/** The resolved payer: a billing contact (and their own patient record), or the patient. */
export interface ResolvedPayer {
  contactId: string | null;
  name: string | null;
  patientId: string | null;
}

interface PaymentPlan {
  accountIds: string[];
  payer: ResolvedPayer;
  state: AccountState;
  outstanding: bigint;
  amount: bigint;
  allocations: PlannedAllocation[];
  error: PaymentPreview['error'];
}

const sum = (values: Iterable<bigint>) => [...values].reduce((total, value) => total + value, 0n);

/**
 * Payments on patient accounts (feature 5, spec P1–P11, ADR-0027/0028): record (with its dry
 * run), refund and void. Every write runs in one `TenantDb` transaction: the patient(s)
 * `FOR SHARE` (a merge waits), then the account lock(s), then the ledger entry through
 * `LedgerWriter`, the `payments` row, its allocations and a settle; audited in the transaction,
 * events after commit. Patient and contact reads need `patient:read` (every role holds it).
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
    private readonly patients: PatientsService,
    private readonly contacts: ContactsService,
    private readonly writer: LedgerWriter,
    private readonly settlement: Settlement,
    private readonly payments: PaymentsRepository,
    private readonly allocations: AllocationsRepository,
    private readonly entries: LedgerEntriesRepository,
    private readonly labels: ChargeLabels,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `POST /billing/payments/preview`: the panel's live allocation; no lock, no write. */
  async preview(input: PaymentInput): Promise<PaymentPreview> {
    this.context.requirePermission('payment:write');
    return this.tenantDb.run(async () => {
      const { currency } = await this.tenancy.currentTenant();
      const plan = await this.plan(input, currency);
      return {
        currency,
        outstanding: fromCents(plan.outstanding),
        remaining: fromCents(plan.error ? plan.outstanding : plan.outstanding - plan.amount),
        allocations: await this.labelPlanned(plan),
        error: plan.error,
      };
    });
  }

  /**
   * `POST /billing/payments` (B1–B5): one payment row per paid account (one for the patient, one
   * per owing account of a household), sharing one receipt number. A replayed `idempotencyKey`
   * returns the first result; with a different request, 409 `payment.idempotency_mismatch`.
   */
  async record(input: PaymentInput, idempotencyKey?: string): Promise<RecordPaymentResult> {
    this.context.requirePermission('payment:write');
    return this.tenantDb.run(() => this.recordIn(input, idempotencyKey));
  }

  /**
   * `POST /billing/payments/:id/refund` (P6): part or all of what is left of a payment, with a
   * reason. Releases its credit first, then its allocations proportionally; reopened charges stay
   * owing. `payment:refund`.
   */
  async refund(paymentId: string, input: RefundInput): Promise<PaymentWriteResult> {
    this.context.requirePermission('payment:refund');
    return this.tenantDb.run(async () => {
      const payment = await this.reversible(paymentId);
      const tenant = await this.tenancy.currentTenant();
      const refundedAt = input.refundedAt ?? this.today(tenant);
      this.assertNotAfterToday(refundedAt, tenant, 'refundedAt');
      if (refundedAt < payment.paidAt) {
        const message = 'A refund cannot be dated before its payment';
        throw new ValidationFailedError(message, [
          { path: 'refundedAt', code: 'before_payment', message },
        ]);
      }
      await this.patients.lockForDependentWrite(payment.patientId);
      await this.settlement.lock([payment.patientId]);

      const reversals = await this.payments.reversalsOf([payment.id]);
      if (reversals.some((row) => row.kind === 'void')) {
        throw new PaymentNotReversibleError('This payment was voided');
      }
      const left = toCents(payment.amount) - sum(reversals.map((row) => toCents(row.amount)));
      const amount = toCents(input.amount);
      if (amount > left) {
        throw new OverRefundError(`At most ${fromCents(left)} of this payment can be refunded`);
      }

      const pairs = (await this.allocations.pairsOf([payment.patientId])).filter(
        (pair) => pair.sourceId === payment.ledgerEntryId,
      );
      const releases: NewAllocation[] = refundReleases({ amount, capacity: left, pairs }).map(
        (line) => ({
          sourceId: payment.ledgerEntryId,
          targetId: line.targetId,
          amount: -line.amount,
          kind: 'release',
          manual: false,
        }),
      );
      const entry = await this.writer.append({
        patientId: payment.patientId,
        kind: 'payment_refund',
        amount: fromCents(amount),
        currency: payment.currency,
        effectiveDate: refundedAt,
        note: null,
        reason: input.reason,
        createdBy: this.context.requireUserId(),
        visitId: null,
        amendmentId: null,
      });
      await this.allocations.insert(releases);
      const refund = await this.payments.insert({
        ...this.reversalOf(payment, entry.id),
        kind: 'refund',
        amount: fromCents(amount),
        method: input.method ?? payment.method,
        paidAt: refundedAt,
        reason: input.reason,
      });
      await this.settlement.settle(payment.patientId);
      await this.audit.record({
        action: 'payment.refund',
        resourceType: 'payment',
        resourceId: payment.id,
        after: { ...refund, releases: releases.map(toFact) },
        reason: input.reason,
      });
      const event: PaymentRefunded = this.events.create(PAYMENT_REFUNDED, {
        paymentId: payment.id,
        refundId: refund.id,
        patientId: payment.patientId,
        amount: refund.amount,
        currency: refund.currency,
        releases: releases.map(toFact),
      });
      await this.events.publish(event);
      return { ids: [refund.id] };
    });
  }

  /**
   * `POST /billing/payments/:id/void` (P7): cancels a mis-entered payment — every row of its
   * receipt (a household's too) — when nothing of it was refunded. Releases all its allocations.
   * `payment:refund`.
   */
  async void(paymentId: string, input: VoidPaymentInput): Promise<PaymentWriteResult> {
    this.context.requirePermission('payment:refund');
    return this.tenantDb.run(async () => {
      const payment = await this.reversible(paymentId);
      const rows = payment.householdGroupId
        ? await this.payments.receiptRows(payment.receiptNumber)
        : [payment];
      const patientIds = [...new Set(rows.map((row) => row.patientId))].sort();
      for (const patientId of patientIds) await this.patients.lockForDependentWrite(patientId);
      await this.settlement.lock(patientIds);

      const reversals = await this.payments.reversalsOf(rows.map((row) => row.id));
      if (reversals.some((row) => row.kind === 'void')) {
        throw new PaymentNotReversibleError('This payment was already voided');
      }
      if (reversals.length > 0) {
        throw new PaymentHasRefundsError('Part of this payment was refunded; refund the rest');
      }
      const tenant = await this.tenancy.currentTenant();
      const today = this.today(tenant);
      const voidIds: string[] = [];
      for (const row of rows) {
        const entry = await this.writer.append({
          patientId: row.patientId,
          kind: 'payment_void',
          amount: row.amount,
          currency: row.currency,
          effectiveDate: today,
          note: null,
          reason: input.reason,
          createdBy: this.context.requireUserId(),
          visitId: null,
          amendmentId: null,
        });
        const voided = await this.payments.insert({
          ...this.reversalOf(row, entry.id),
          kind: 'void',
          amount: row.amount,
          method: row.method,
          paidAt: today,
          reason: input.reason,
        });
        voidIds.push(voided.id);
        const released = await this.settlement.settle(row.patientId);
        await this.audit.record({
          action: 'payment.void',
          resourceType: 'payment',
          resourceId: row.id,
          after: { ...voided, releases: released.map(toFact) },
          reason: input.reason,
        });
      }
      const event: PaymentVoided = this.events.create(PAYMENT_VOIDED, {
        receiptNumber: payment.receiptNumber,
        paymentIds: rows.map((row) => row.id),
        voidIds,
        patientIds,
      });
      await this.events.publish(event);
      return { ids: voidIds };
    });
  }

  // --- Record ---

  private async recordIn(input: PaymentInput, key: string | undefined) {
    if (key) {
      // A retry sent while the first request still runs waits here, then replays it (P11).
      await this.payments.lockIdempotencyKey(key);
      const existing = await this.payments.findByIdempotencyKey(key);
      if (existing.length > 0) return this.replay(existing, input);
    }
    const tenant = await this.tenancy.currentTenant();
    this.assertNotAfterToday(input.paidAt, tenant, 'paidAt');
    await this.patients.lockForDependentWrite(input.patientId);
    const plan = await this.plan(input, tenant.currency, async (accountIds) => {
      for (const id of accountIds.filter((id) => id !== input.patientId).sort()) {
        await this.patients.lockForDependentWrite(id);
      }
      await this.settlement.lock(accountIds);
    });
    if (plan.error === 'payment.nothing_outstanding') {
      throw new NothingOutstandingError('Nothing is owed on this account');
    }
    if (plan.error === 'payment.over_outstanding') {
      throw new PaymentOverOutstandingError(
        `The amount is more than the ${fromCents(plan.outstanding)} owed`,
      );
    }

    const owner = new Map(plan.state.targets.map((target) => [target.entryId, target.patientId]));
    const byPatient = new Map<string, PlannedAllocation[]>();
    for (const line of plan.allocations) {
      const patientId = owner.get(line.targetId) ?? input.patientId;
      byPatient.set(patientId, [...(byPatient.get(patientId) ?? []), line]);
    }
    const paidIds = [...byPatient.keys()].sort((a, b) =>
      a === input.patientId ? -1 : b === input.patientId ? 1 : a < b ? -1 : 1,
    );
    const receiptNumber = await this.payments.nextReceiptNumber();
    const householdGroupId = paidIds.length > 1 ? newId() : null;
    const recordedBy = this.context.requireUserId();
    const written: Payment[] = [];
    const facts: ReturnType<typeof toFact>[] = [];
    let remaining = 0n;

    for (const patientId of paidIds) {
      const lines = byPatient.get(patientId) ?? [];
      const amount = sum(lines.map((line) => line.amount));
      const entry = await this.writer.append({
        patientId,
        kind: 'payment',
        amount: fromCents(-amount),
        currency: tenant.currency,
        effectiveDate: input.paidAt,
        note: input.note ?? null,
        reason: null,
        createdBy: recordedBy,
        visitId: null,
        amendmentId: null,
      });
      const rows: NewAllocation[] = lines.map((line) => ({
        sourceId: entry.id,
        targetId: line.targetId,
        amount: line.amount,
        kind: 'allocation',
        manual: line.manual,
      }));
      await this.allocations.insert(rows);
      await this.settlement.settle(patientId, new Set([entry.id]));
      const balanceAfter = await this.balanceIn(patientId, tenant.currency);
      remaining += balanceAfter;
      const payment = await this.payments.insert({
        patientId,
        kind: 'payment',
        amount: fromCents(amount),
        currency: tenant.currency,
        method: input.method,
        paidAt: input.paidAt,
        reference: input.reference ?? null,
        note: input.note ?? null,
        reason: null,
        receiptNumber,
        householdGroupId,
        payerContactId: plan.payer.contactId,
        reversesPaymentId: null,
        ledgerEntryId: entry.id,
        idempotencyKey: key ?? null,
        balanceAfter: fromCents(balanceAfter),
        branchId: this.context.branchId ?? null,
        recordedBy,
      });
      written.push(payment);
      facts.push(...rows.map(toFact));
      await this.audit.record({
        action: 'payment.create',
        resourceType: 'payment',
        resourceId: payment.id,
        after: { ...payment, allocations: rows.map(toFact) },
      });
    }

    const event: PaymentRecorded = this.events.create(PAYMENT_RECORDED, {
      receiptNumber,
      paymentIds: written.map((payment) => payment.id),
      patientIds: paidIds,
      householdGroupId,
      amount: fromCents(plan.amount),
      currency: tenant.currency,
      allocations: facts,
    });
    await this.events.publish(event);
    return {
      receiptNumber,
      paymentIds: written.map((payment) => payment.id),
      householdGroupId,
      amount: fromCents(plan.amount),
      currency: tenant.currency,
      remaining: fromCents(remaining),
      allocations: await this.labelPlanned(plan),
    };
  }

  /** The first request's result for a replayed key; any difference → 409. */
  private async replay(rows: Payment[], input: PaymentInput): Promise<RecordPaymentResult> {
    const [first] = rows;
    const same =
      first !== undefined &&
      // A household payment writes rows only for the accounts it paid, maybe not the patient's.
      (input.scope === 'household' || rows.some((row) => row.patientId === input.patientId)) &&
      sum(rows.map((row) => toCents(row.amount))) === toCents(input.amount) &&
      rows.every((row) => row.method === input.method && row.paidAt === input.paidAt);
    if (!same) {
      throw new IdempotencyMismatchError('This Idempotency-Key was used for another payment');
    }
    const lines = await this.allocations.linesOfSources(rows.map((row) => row.ledgerEntryId));
    return {
      receiptNumber: first.receiptNumber,
      paymentIds: rows.map((row) => row.id),
      householdGroupId: first.householdGroupId,
      amount: fromCents(sum(rows.map((row) => toCents(row.amount)))),
      currency: first.currency,
      remaining: fromCents(sum(rows.map((row) => toCents(row.balanceAfter ?? '0')))),
      allocations: await this.labels.label(lines),
    };
  }

  /**
   * Resolves the payer and the paid accounts, reads them (after `lock`, when recording) and plans
   * the allocation: the cap is what those accounts owe in the tenant currency.
   */
  private async plan(
    input: PaymentInput,
    currency: string,
    lock?: (accountIds: string[]) => Promise<void>,
  ): Promise<PaymentPlan> {
    const payer = await this.resolvePayer(input.patientId, input.payerContactId);
    const accountIds =
      input.scope === 'household'
        ? await this.householdIds(input.patientId, payer)
        : [input.patientId];
    if (lock) {
      await lock(accountIds);
      // An account last written before payments existed may never have been settled (a
      // write-off with no allocations): settle it before reading what it owes.
      for (const id of accountIds) await this.settlement.settle(id);
    }
    const state = await this.settlement.state(accountIds, currency);
    const owed = outstandingByTarget(state.targets, state.pairs);
    // The cap is what is owed by the ledger (P1), whatever the allocations say.
    const sums = await this.entries.sumsByPatient(accountIds);
    const owedByLedger = sum(
      sums
        .filter((row) => row.currency === currency)
        .map((row) => (toCents(row.amount) > 0n ? toCents(row.amount) : 0n)),
    );
    const byTargets = sum(owed.values());
    const outstanding = byTargets < owedByLedger ? byTargets : owedByLedger;
    const isOpen = (target: AccountTarget | undefined) =>
      target !== undefined && (owed.get(target.entryId) ?? 0n) > 0n;

    const manual = input.targetEntryId
      ? state.targets.find((target) => target.entryId === input.targetEntryId)
      : undefined;
    if (input.targetEntryId && !isOpen(manual)) {
      throw new PaymentTargetInvalidError('That charge is not open on this account');
    }
    const context = input.contextVisitId
      ? state.targets.find((target) => target.visitId === input.contextVisitId)
      : undefined;
    const amount = toCents(input.amount);
    const error: PaymentPreview['error'] =
      outstanding <= 0n
        ? 'payment.nothing_outstanding'
        : amount > outstanding
          ? 'payment.over_outstanding'
          : null;
    const { allocations } = planPayment({
      amount: amount > outstanding ? outstanding : amount,
      targets: state.targets,
      pairs: state.pairs,
      ...(manual ? { manualTargetId: manual.entryId } : {}),
      ...(isOpen(context) && context ? { contextTargetId: context.entryId } : {}),
    });
    return { accountIds, payer, state, outstanding, amount, allocations, error };
  }

  /**
   * `payerContactId` omitted → the primary billing contact (or none); `null` → the patient pays;
   * an id → one of the patient's billing contacts (else 422 `payment.invalid_payer`).
   */
  async resolvePayer(
    patientId: string,
    payerContactId: string | null | undefined,
  ): Promise<ResolvedPayer> {
    const billing = (await this.contacts.contactsOf(patientId)).filter(
      (link) => link.isBillingContact,
    );
    const link =
      payerContactId === undefined
        ? billing.find((candidate) => candidate.isPrimaryBilling)
        : payerContactId === null
          ? undefined
          : billing.find((candidate) => candidate.contact.id === payerContactId);
    if (payerContactId && !link) {
      throw new PayerNotBillingContactError('The payer is not a billing contact of this patient');
    }
    if (!link) return { contactId: null, name: null, patientId: null };
    const linked = link.contact.linkedPatient;
    return {
      contactId: link.contact.id,
      name: link.contact.fullName,
      patientId: linked && !linked.archived ? linked.id : null,
    };
  }

  /** B5, Q4: the patient, the payer's own record (when a patient) and everyone they bill for. */
  async householdIds(patientId: string, payer: ResolvedPayer): Promise<string[]> {
    if (!payer.contactId) return [patientId];
    const billed = (await this.contacts.patientsBilledBy(payer.contactId)).filter(
      (patient) => patient.archivedAt === null,
    );
    return [
      ...new Set([
        patientId,
        ...(payer.patientId ? [payer.patientId] : []),
        ...billed.map((patient) => patient.id),
      ]),
    ];
  }

  // --- Shared rules ---

  private async labelPlanned(plan: PaymentPlan) {
    const targets = new Map(plan.state.targets.map((target) => [target.entryId, target]));
    return this.labels.label(
      plan.allocations.flatMap((line) => {
        const target = targets.get(line.targetId);
        return target
          ? [
              {
                targetId: line.targetId,
                patientId: target.patientId,
                kind: target.kind,
                visitId: target.visitId,
                date: target.date,
                amount: line.amount,
              },
            ]
          : [];
      }),
    );
  }

  /** A payment that can be refunded or voided: it exists and is a `payment` row. */
  private async reversible(paymentId: string): Promise<Payment> {
    const payment = await this.payments.findById(paymentId);
    if (!payment) throw new PaymentNotFoundError('Payment not found');
    if (payment.kind !== 'payment') {
      throw new PaymentNotReversibleError('Only a payment can be refunded or voided');
    }
    return payment;
  }

  /** The fields a refund or void copies from its payment. */
  private reversalOf(payment: Payment, ledgerEntryId: string) {
    return {
      patientId: payment.patientId,
      currency: payment.currency,
      reference: null,
      note: null,
      receiptNumber: payment.receiptNumber,
      householdGroupId: payment.householdGroupId,
      payerContactId: payment.payerContactId,
      reversesPaymentId: payment.id,
      ledgerEntryId,
      idempotencyKey: null,
      balanceAfter: null,
      branchId: this.context.branchId ?? null,
      recordedBy: this.context.requireUserId(),
    };
  }

  private async balanceIn(patientId: string, currency: string): Promise<bigint> {
    const sums = await this.entries.sumsByPatient([patientId]);
    return toCents(sums.find((row) => row.currency === currency)?.amount ?? '0');
  }

  private today(tenant: Tenant): string {
    return localDate(this.clock.now(), tenant.timeZone);
  }

  private assertNotAfterToday(date: string, tenant: Tenant, path: string): void {
    if (date > this.today(tenant)) {
      const message = 'Date cannot be in the future';
      throw new ValidationFailedError(message, [{ path, code: 'future_date', message }]);
    }
  }
}
