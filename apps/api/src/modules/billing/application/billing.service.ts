import {
  type AdjustmentInput,
  type CreateWithOpeningBalance,
  type CurrencyLock,
  fromCents,
  type LedgerEntryKind,
  type OpeningBalanceInput,
  type OpeningBalanceResult,
  type Patient,
  type PatientBalance,
  type Tenant,
  toCents,
  type VisitBalance,
  type VisitFinancialSummary,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate } from '../../../platform/kernel/local-date';
import { requestHash } from '../../../platform/kernel/request-hash';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import { VisitNotLiveError, VisitsService } from '../../clinical';
import { PatientNotFoundError, PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { patientBalance, sumBalances } from '../domain/balances';
import type { LedgerEntry } from '../domain/ledger-entry';
import { LedgerIdempotencyMismatchError } from '../domain/ledger-errors';
import { AllocationsRepository } from '../persistence/allocations.repository';
import { LedgerEntriesRepository } from '../persistence/ledger-entries.repository';
import { LedgerWriter } from './ledger-writer';
import { Settlement } from './settlement';

/** The fields a caller chooses; the kind, currency and creator are set by `append`. */
type EntryFields = Pick<LedgerEntry, 'amount' | 'effectiveDate' | 'note' | 'reason'>;

/** An `Idempotency-Key` with the fingerprint of the request it came with (H5). */
interface Idempotency {
  key: string;
  hash: string;
}

/**
 * The patient ledger of the current tenant (docs/modules/billing.md): opening balances,
 * adjustments, balances (design Q1, Q12, Q13) and a completed visit's summary (spec W2). Entries
 * are stamped with the tenant currency; every write re-checks `payment:write`, holds the patient
 * row `FOR SHARE` (`PatientsService.lockForDependentWrite`, so a concurrent merge waits for it)
 * and goes through `LedgerWriter` (audited in the same transaction, `LedgerEntryRecorded` after
 * commit). Visit charges are posted by `VisitChargeSubscriber`, not here. Patient existence
 * always comes from `PatientsService`, which requires `patient:read` — every system role holds it.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly writer: LedgerWriter,
    private readonly tenancy: TenancyService,
    private readonly patients: PatientsService,
    private readonly entries: LedgerEntriesRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly visits: VisitsService,
    private readonly settlement: Settlement,
    private readonly allocations: AllocationsRepository,
  ) {}

  /**
   * `POST /billing/opening-balances` (design Q1): one transaction — the patient, its display
   * number and the `opening_balance` entry commit or roll back together. `asOf` is checked
   * against the tenant's today before anything is written; the patient's own field errors are
   * reported under `patient.` so they point into this request's body.
   *
   * With an `idempotencyKey` (the route, feature 7 H5) a retry of the same request answers with
   * the patient the first one created and that patient's balance, as they are now; another
   * request under the key → 409 `ledger.idempotency_mismatch`. The key is kept on the entry,
   * which commits with the patient, so finding the entry is finding both.
   */
  async createWithOpeningBalance(
    input: CreateWithOpeningBalance,
    idempotencyKey?: string,
  ): Promise<OpeningBalanceResult> {
    this.context.requirePermission('payment:write');
    this.context.requirePermission('patient:write');
    return this.tenantDb.run(async () => {
      const idempotency = this.idempotencyOf(idempotencyKey, input);
      const first = await this.replayed(idempotency);
      if (first) {
        const patient = await this.patients.get(first.patientId);
        return { patient, balance: await this.balanceIn(first.patientId) };
      }
      const tenant = await this.tenancy.currentTenant();
      this.assertNotAfterToday(input.openingBalance.asOf, tenant, 'openingBalance.asOf');
      const patient = await this.createPatient(input.patient);
      // Just created in this transaction: nobody else can see, merge or archive it yet.
      const entry = await this.appendOpeningBalance(
        patient.id,
        input.openingBalance,
        tenant,
        idempotency,
      );
      const balance = { patientId: patient.id, balances: sumBalances([entry]), charged: [] };
      return { patient, balance };
    });
  }

  /**
   * An `opening_balance` entry dated `asOf` (a building block for feature 6 import). "Only on
   * create" is the route's rule, not the schema's (design Q12). Unknown patient → 404, merged
   * away → 409 `patient.merged`. Returns the patient's balance after the entry.
   */
  async recordOpeningBalance(
    patientId: string,
    input: OpeningBalanceInput,
  ): Promise<PatientBalance> {
    this.context.requirePermission('payment:write');
    return this.tenantDb.run(async () => {
      const tenant = await this.tenancy.currentTenant();
      this.assertNotAfterToday(input.asOf, tenant, 'asOf');
      await this.patients.lockForDependentWrite(patientId);
      await this.appendOpeningBalance(patientId, input, tenant);
      await this.settlement.settle(patientId);
      return this.balanceIn(patientId);
    });
  }

  /**
   * A signed correction with a reason (feature 7, H4): a sensitive money action, so it needs
   * `payment:refund`, the trust level of a refund. Archived patients are allowed (a write-off);
   * merged-away ones are refused like in `recordOpeningBalance`. Returns the balance after the
   * entry. With an `idempotencyKey` a retry records nothing new (H5).
   */
  async adjustBalance(
    patientId: string,
    input: AdjustmentInput,
    idempotencyKey?: string,
  ): Promise<PatientBalance> {
    this.context.requirePermission('payment:refund');
    return this.tenantDb.run(async () => {
      const idempotency = this.idempotencyOf(idempotencyKey, { patientId, ...input });
      const first = await this.replayed(idempotency);
      if (first) return this.balanceIn(first.patientId);
      const tenant = await this.tenancy.currentTenant();
      this.assertNotAfterToday(input.effectiveDate, tenant, 'effectiveDate');
      await this.patients.lockForDependentWrite(patientId);
      const entry = await this.append(
        patientId,
        'adjustment',
        tenant,
        {
          amount: input.amount,
          effectiveDate: input.effectiveDate,
          note: input.note ?? null,
          reason: input.reason,
        },
        idempotency,
      );
      // A write-off (below zero) covers open charges oldest first; a debit takes any credit.
      await this.settlement.settle(
        patientId,
        toCents(entry.amount) < 0n ? new Set([entry.id]) : new Set<string>(),
      );
      return this.balanceIn(patientId);
    });
  }

  /**
   * Whether the tenant's currency is locked: any ledger entry exists (H6, ADR-0035). For the
   * admin Settings tab; `CurrencyLockSubscriber` is the enforcement.
   */
  async currencyLock(): Promise<CurrencyLock> {
    this.context.requirePermission('tenant:read');
    return this.tenantDb.run(async () => {
      const tenant = await this.tenancy.currentTenant();
      return { locked: await this.entries.any(), currency: tenant.currency };
    });
  }

  /**
   * `balances: []` when the patient has no entries (or they net to zero in every currency);
   * `charged` sums the visit entries alone — charges, adjustments, reversals (the Record's
   * _Lifetime billed_, W8).
   */
  async balanceOf(patientId: string): Promise<PatientBalance> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () => {
      const [patient] = await this.patients.getMany([patientId]);
      if (!patient) throw new PatientNotFoundError('Patient not found');
      return this.balanceIn(patientId);
    });
  }

  /**
   * Balances of the visible patients among `patientIds`, in input order; unknown (or other
   * tenants') ids are omitted, patients without entries get `balances: []`. One aggregate query.
   */
  async balancesFor(patientIds: readonly string[]): Promise<PatientBalance[]> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () => {
      const visible = new Set((await this.patients.getMany(patientIds)).map(({ id }) => id));
      const known = [...new Set(patientIds)].filter((id) => visible.has(id));
      const sums = await this.entries.sumsByPatient(known);
      return known.map((patientId) =>
        patientBalance(
          patientId,
          sums.filter((sum) => sum.patientId === patientId),
        ),
      );
    });
  }

  /**
   * Ids of the patients owing in any currency (design Q13), archived ones included, in id order.
   * A building block for `billing`'s patient views; one SQL aggregate.
   */
  async patientIdsOwing(): Promise<string[]> {
    this.context.requirePermission('payment:read');
    return this.entries.patientIdsOwing();
  }

  /**
   * What payments cover on the visit (P8): Σ the allocations to its charge whose source is a
   * `payment` — write-offs and other credit don't block a void. Read inside the void transaction
   * (ADR-0026) under the account lock, whatever the caller may read, so it checks no permission
   * and has no route; `balancesForVisits` is the gated read.
   */
  async paidOn(visitId: string): Promise<string> {
    const allocated = await this.allocations.allocatedToVisits([visitId]);
    return fromCents(allocated.get(visitId)?.payments ?? 0n);
  }

  /**
   * Per visit among `visitIds` (4b): `charged` = Σ its visit entries (charge, adjustments,
   * reversal), `paid` (Σ allocated to it: payments, applied credit, write-offs), `outstanding`; in
   * input order, visits without entries omitted. RLS limits it to the tenant's entries.
   */
  async balancesForVisits(visitIds: readonly string[]): Promise<VisitBalance[]> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () => {
      const sums = await this.entries.sumsByVisit(visitIds);
      const byVisit = new Map(sums.map((sum) => [sum.visitId, sum]));
      const allocated = await this.allocations.allocatedToVisits(visitIds);
      const balances: VisitBalance[] = [];
      for (const visitId of new Set(visitIds)) {
        const sum = byVisit.get(visitId);
        if (!sum) continue;
        const charged = toCents(sum.amount);
        const paid = allocated.get(visitId)?.all ?? 0n;
        balances.push({
          visitId,
          currency: sum.currency,
          charged: fromCents(charged),
          paid: fromCents(paid),
          paidByPayments: fromCents(allocated.get(visitId)?.payments ?? 0n),
          outstanding: fromCents(charged - paid),
        });
      }
      return balances;
    });
  }

  /**
   * A finished visit's figures (spec W2), in the visit currency and from the ledger alone: the
   * entries were posted in the completion's, amendment's or void's transaction, so they are
   * already there. _This visit_ = Σ its visit entries (the charge, its adjustments, a reversal; 0
   * when none: a zero total, W20), _paid_ = Σ allocated to it (feature 5), with the payments
   * that cover it; _Previous_ = the balance less this visit's outstanding; the total = the balance. Needs `payment:read`, and `visit:read` for `VisitsService.visitMoney`:
   * unknown or discarded → 404 `visit.not_found`; a live visit → 409 `visit.not_live` (it has no
   * charge yet). Balances in other currencies are left out — known gap, `docs/modules/billing.md`.
   */
  async visitSummary(visitId: string): Promise<VisitFinancialSummary> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () => {
      const visit = await this.visits.visitMoney(visitId);
      if (visit.status === 'in_progress' || visit.status === 'paused') {
        throw new VisitNotLiveError('The visit is still live; its summary follows completion');
      }
      const visitEntries = (await this.entries.listForVisit(visitId)).filter(
        (entry) => entry.currency === visit.currency,
      );
      const sums = await this.entries.sumsByPatient([visit.patientId]);
      const chargeCents = visitEntries.reduce((total, entry) => total + toCents(entry.amount), 0n);
      const paidCents =
        (await this.allocations.allocatedToVisits([visitId])).get(visitId)?.all ?? 0n;
      const balanceCents = sums
        .filter(({ currency }) => currency === visit.currency)
        .reduce((total, sum) => total + toCents(sum.amount), 0n);
      return {
        visitId,
        currency: visit.currency,
        visit: {
          total: fromCents(chargeCents),
          paid: fromCents(paidCents),
          outstanding: fromCents(chargeCents - paidCents),
        },
        previous: fromCents(balanceCents - (chargeCents - paidCents)),
        totalOutstanding: fromCents(balanceCents),
        payments: await this.allocations.paymentsForVisit(visitId),
      };
    });
  }

  // --- Shared rules ---

  /** `PatientsService.create`, with its field errors re-pathed under `patient.`. */
  private async createPatient(input: CreateWithOpeningBalance['patient']): Promise<Patient> {
    try {
      return await this.patients.create(input);
    } catch (error) {
      if (!(error instanceof ValidationFailedError)) throw error;
      throw new ValidationFailedError(
        error.message,
        error.issues.map((issue) => ({ ...issue, path: `patient.${issue.path}` })),
      );
    }
  }

  private idempotencyOf(key: string | undefined, request: unknown): Idempotency | null {
    return key === undefined ? null : { key, hash: requestHash(request) };
  }

  /**
   * The entry a request with this key already recorded (H5), or undefined for a first request.
   * Requests sharing a key run one at a time (an advisory lock held to the end of the
   * transaction), so a retry waits for the first and then finds its entry. Another request under
   * the key → 409 `ledger.idempotency_mismatch`.
   */
  private async replayed(idempotency: Idempotency | null): Promise<LedgerEntry | undefined> {
    if (!idempotency) return undefined;
    await this.entries.lockIdempotencyKey(idempotency.key);
    const first = await this.entries.findByIdempotencyKey(idempotency.key);
    if (first && first.hash !== idempotency.hash) {
      throw new LedgerIdempotencyMismatchError(
        'This Idempotency-Key was already used for a different request',
      );
    }
    return first?.entry;
  }

  /** No checks: callers have validated `asOf` and locked (or just created) the patient. */
  private appendOpeningBalance(
    patientId: string,
    input: OpeningBalanceInput,
    tenant: Tenant,
    idempotency: Idempotency | null = null,
  ): Promise<LedgerEntry> {
    return this.append(
      patientId,
      'opening_balance',
      tenant,
      {
        amount: input.amount,
        effectiveDate: input.asOf,
        note: input.note ?? null,
        reason: null,
      },
      idempotency,
    );
  }

  /** One entry in the tenant currency, through `LedgerWriter` (inserted, audited, published). */
  private append(
    patientId: string,
    kind: LedgerEntryKind,
    tenant: Tenant,
    fields: EntryFields,
    idempotency: Idempotency | null = null,
  ): Promise<LedgerEntry> {
    return this.writer.append({
      patientId,
      kind,
      currency: tenant.currency,
      createdBy: this.context.requireUserId(),
      visitId: null,
      amendmentId: null,
      ...fields,
      ...(idempotency ? { idempotency } : {}),
    });
  }

  private async balanceIn(patientId: string): Promise<PatientBalance> {
    return patientBalance(patientId, await this.entries.sumsByPatient([patientId]));
  }

  /**
   * The contract only refuses obviously-future dates (it knows UTC, not the tenant); the tenant's
   * today in its time zone is the source of truth (CLAUDE.md §5).
   */
  private assertNotAfterToday(date: string, tenant: Tenant, path: string): void {
    if (date > localDate(this.clock.now(), tenant.timeZone)) {
      const message = 'Date cannot be in the future';
      throw new ValidationFailedError(message, [{ path, code: 'future_date', message }]);
    }
  }
}
