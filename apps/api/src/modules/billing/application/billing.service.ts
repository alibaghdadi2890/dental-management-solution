import {
  type AdjustmentInput,
  type CreateWithOpeningBalance,
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
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate } from '../../../platform/kernel/local-date';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import { AuditService } from '../../audit';
import { VisitNotLiveError, VisitsService } from '../../clinical';
import { PatientNotFoundError, PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { patientBalance, sumBalances } from '../domain/balances';
import type { LedgerEntry } from '../domain/ledger-entry';
import { LedgerEntriesRepository } from '../persistence/ledger-entries.repository';
import { LedgerWriter } from './ledger-writer';

/** The fields a caller chooses; the kind, currency and creator are set by `append`. */
type EntryFields = Pick<LedgerEntry, 'amount' | 'effectiveDate' | 'note' | 'reason'>;

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
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly writer: LedgerWriter,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
    private readonly patients: PatientsService,
    private readonly entries: LedgerEntriesRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly visits: VisitsService,
  ) {}

  /**
   * `POST /billing/opening-balances` (design Q1): one transaction — the patient, its display
   * number and the `opening_balance` entry commit or roll back together. `asOf` is checked
   * against the tenant's today before anything is written; the patient's own field errors are
   * reported under `patient.` so they point into this request's body.
   */
  async createWithOpeningBalance(input: CreateWithOpeningBalance): Promise<OpeningBalanceResult> {
    this.context.requirePermission('payment:write');
    this.context.requirePermission('patient:write');
    return this.tenantDb.run(async () => {
      const tenant = await this.tenancy.currentTenant();
      this.assertNotAfterToday(input.openingBalance.asOf, tenant, 'openingBalance.asOf');
      const patient = await this.createPatient(input.patient);
      // Just created in this transaction: nobody else can see, merge or archive it yet.
      const entry = await this.appendOpeningBalance(patient.id, input.openingBalance, tenant);
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
      return this.balanceIn(patientId);
    });
  }

  /**
   * A signed correction with a reason (no UI in feature 3). Archived patients are allowed (a
   * write-off); merged-away ones are refused like in `recordOpeningBalance`. Returns the balance
   * after the entry.
   */
  async adjustBalance(patientId: string, input: AdjustmentInput): Promise<PatientBalance> {
    this.context.requirePermission('payment:write');
    return this.tenantDb.run(async () => {
      const tenant = await this.tenancy.currentTenant();
      this.assertNotAfterToday(input.effectiveDate, tenant, 'effectiveDate');
      await this.patients.lockForDependentWrite(patientId);
      await this.append(patientId, 'adjustment', tenant, {
        amount: input.amount,
        effectiveDate: input.effectiveDate,
        note: input.note ?? null,
        reason: input.reason,
      });
      return this.balanceIn(patientId);
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
   * What is paid on the visit — payment allocations arrive with feature 5, so always 0 for now.
   * Read inside the void transaction (ADR-0026) whatever the caller may read, so it checks no
   * permission and has no route; `balancesForVisits` is the gated read.
   */
  paidOn(_visitId: string): Promise<string> {
    return Promise.resolve(fromCents(0n));
  }

  /**
   * Per visit among `visitIds` (4b): `charged` = Σ its visit entries (charge, adjustments,
   * reversal), `paid` (0 until feature 5), `outstanding`; in input order, visits without entries
   * omitted. RLS limits it to the tenant's entries.
   */
  async balancesForVisits(visitIds: readonly string[]): Promise<VisitBalance[]> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () => {
      const sums = await this.entries.sumsByVisit(visitIds);
      const byVisit = new Map(sums.map((sum) => [sum.visitId, sum]));
      const balances: VisitBalance[] = [];
      for (const visitId of new Set(visitIds)) {
        const sum = byVisit.get(visitId);
        if (!sum) continue;
        const charged = toCents(sum.amount);
        const paid = toCents(await this.paidOn(visitId));
        balances.push({
          visitId,
          currency: sum.currency,
          charged: fromCents(charged),
          paid: fromCents(paid),
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
   * when none: a zero total, W20), nothing paid yet; _Previous_ = the balance less that; the
   * total = the balance. Needs `payment:read`, and `visit:read` for `VisitsService.visitMoney`:
   * unknown or discarded → 404 `visit.not_found`; a live visit → 409 `visit.not_live` (it has no
   * charge yet). Balances in other currencies are left out — known gap, `docs/modules/billing.md`.
   *
   * A visit entry's own `patientId` can differ from `visit.patientId` for a while: a merge
   * re-points the visit in its own transaction, but entries posted before that merge still sit
   * on the dropped patient until the async `merge-ledger` job moves them (design Q9, ADR-0024's
   * "Consequences"). While that window is open the balance is summed over every patient id the
   * visit's entries name (same currency) so _this visit_ / _previous_ / the total stay
   * consistent.
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
      const patientIds = [
        ...new Set([visit.patientId, ...visitEntries.map((entry) => entry.patientId)]),
      ];
      const sums = await this.entries.sumsByPatient(patientIds);
      const chargeCents = visitEntries.reduce((total, entry) => total + toCents(entry.amount), 0n);
      const paidCents = toCents(await this.paidOn(visitId));
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
      };
    });
  }

  /**
   * The merge re-point (design Q9), run by `MergeLedgerWorker`. In one transaction it moves
   * every entry of the dropped patient to the patient the kept one finally lives on
   * (`PatientsService.survivorOf`: the kept patient itself, or — when it has since been merged
   * away too — the end of the chain), holding that survivor `FOR SHARE` so it cannot be merged
   * away before this commits. Jobs of a merge chain may therefore run in any order and still end
   * on the survivor. When anything moved it audits `ledger_entry.repoint` on the survivor (after =
   * `{ droppedId, keptId, count }`) so it shows in that patient's history. Idempotent: a re-run
   * finds nothing to move and records nothing. Returns the number of entries moved.
   *
   * It moves nothing (and logs the ids) unless the dropped patient really was merged into the
   * kept patient's chain — `survivorOf(droppedId)` is the same survivor — so a malformed or
   * forged job cannot move a live patient's entries, and an unknown kept patient (or another
   * tenant's) moves nothing.
   *
   * Not permission-gated: it is the system's follow-up to a merge the user was allowed to make,
   * and a job actor holds no permissions. It refuses to run outside a job or system task instead.
   */
  async repointMergedEntries(keptId: string, droppedId: string): Promise<number> {
    const actorKind = this.context.actorKind;
    if (actorKind !== 'job' && actorKind !== 'system') {
      throw new Error('repointMergedEntries runs only in the merge job');
    }
    return this.tenantDb.run(async () => {
      const survivorId = await this.patients.survivorOf(keptId);
      if (survivorId === null || (await this.patients.survivorOf(droppedId)) !== survivorId) {
        this.logger.warn({ keptId, droppedId }, 'ledger re-point skipped: not a merged pair');
        return 0;
      }
      const count = await this.entries.repointPatient(droppedId, survivorId);
      if (count > 0) {
        await this.audit.record({
          action: 'ledger_entry.repoint',
          resourceType: 'patient',
          resourceId: survivorId,
          after: { droppedId, keptId, count },
        });
      }
      return count;
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

  /** No checks: callers have validated `asOf` and locked (or just created) the patient. */
  private appendOpeningBalance(
    patientId: string,
    input: OpeningBalanceInput,
    tenant: Tenant,
  ): Promise<LedgerEntry> {
    return this.append(patientId, 'opening_balance', tenant, {
      amount: input.amount,
      effectiveDate: input.asOf,
      note: input.note ?? null,
      reason: null,
    });
  }

  /** One entry in the tenant currency, through `LedgerWriter` (inserted, audited, published). */
  private append(
    patientId: string,
    kind: LedgerEntryKind,
    tenant: Tenant,
    fields: EntryFields,
  ): Promise<LedgerEntry> {
    return this.writer.append({
      patientId,
      kind,
      currency: tenant.currency,
      createdBy: this.context.requireUserId(),
      visitId: null,
      amendmentId: null,
      ...fields,
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
