import type {
  AdjustmentInput,
  CreateWithOpeningBalance,
  LedgerEntryKind,
  OpeningBalanceInput,
  OpeningBalanceResult,
  PatientBalance,
  Patient,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate } from '../../../platform/kernel/local-date';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import { AuditService } from '../../audit';
import { PatientNotFoundError, PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { isOwing, sumBalances } from '../domain/balances';
import type { LedgerEntry } from '../domain/ledger-entry';
import { LEDGER_ENTRY_RECORDED, type LedgerEntryRecorded } from '../events/ledger-events';
import { LedgerEntriesRepository } from '../persistence/ledger-entries.repository';

const NOT_FOUND = 'Patient not found';

/**
 * The patient ledger of the current tenant (docs/modules/billing.md): opening balances,
 * adjustments and balances (design Q1, Q12, Q13). Entries are stamped with the tenant currency;
 * every write re-checks `payment:write`, is audited in the same transaction and emits
 * `LedgerEntryRecorded` after commit. Patient existence always comes from `PatientsService`
 * (`getMany`, which requires `patient:read` — every system role holds it).
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
    private readonly patients: PatientsService,
    private readonly entries: LedgerEntriesRepository,
    @Inject(CLOCK) private readonly clock: Clock,
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
    await this.assertNotAfterToday(input.openingBalance.asOf, 'openingBalance.asOf');
    return this.tenantDb.run(async () => {
      const patient = await this.createPatient(input.patient);
      const balance = await this.recordOpeningBalance(patient.id, input.openingBalance);
      return { patient, balance };
    });
  }

  /**
   * An `opening_balance` entry dated `asOf` (a building block for the create above and for the
   * feature 6 import). "Only on create" is the route's rule, not the schema's (design Q12).
   * Returns the patient's balance after the entry.
   */
  async recordOpeningBalance(
    patientId: string,
    input: OpeningBalanceInput,
  ): Promise<PatientBalance> {
    this.context.requirePermission('payment:write');
    await this.assertNotAfterToday(input.asOf, 'asOf');
    return this.tenantDb.run(async () => {
      await this.requirePatient(patientId);
      await this.record(patientId, 'opening_balance', {
        amount: input.amount,
        effectiveDate: input.asOf,
        note: input.note ?? null,
        reason: null,
      });
      return this.balanceIn(patientId);
    });
  }

  /** A signed correction with a reason (no UI in feature 3). Returns the balance after it. */
  async adjustBalance(patientId: string, input: AdjustmentInput): Promise<PatientBalance> {
    this.context.requirePermission('payment:write');
    await this.assertNotAfterToday(input.effectiveDate, 'effectiveDate');
    return this.tenantDb.run(async () => {
      await this.requirePatient(patientId);
      await this.record(patientId, 'adjustment', {
        amount: input.amount,
        effectiveDate: input.effectiveDate,
        note: input.note ?? null,
        reason: input.reason,
      });
      return this.balanceIn(patientId);
    });
  }

  /** `balances: []` when the patient has no entries (or they net to zero in every currency). */
  async balanceOf(patientId: string): Promise<PatientBalance> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () => {
      await this.requirePatient(patientId);
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
      return known.map((patientId) => ({
        patientId,
        balances: sumBalances(sums.filter((sum) => sum.patientId === patientId)),
      }));
    });
  }

  /**
   * Ids of the patients owing in any currency (design Q13), archived ones included, in no
   * particular order. Not permission-gated: a building block for `billing`'s own patient views,
   * which gate themselves; never expose it directly.
   */
  async patientIdsOwing(): Promise<string[]> {
    const byPatient = new Map<string, { amount: string; currency: string }[]>();
    for (const sum of await this.entries.sumsByPatient()) {
      const sums = byPatient.get(sum.patientId) ?? [];
      sums.push({ amount: sum.amount, currency: sum.currency });
      byPatient.set(sum.patientId, sums);
    }
    return [...byPatient]
      .filter(([, sums]) => isOwing(sumBalances(sums)))
      .map(([patientId]) => patientId);
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

  private async record(
    patientId: string,
    kind: LedgerEntryKind,
    fields: Pick<LedgerEntry, 'amount' | 'effectiveDate' | 'note' | 'reason'>,
  ): Promise<LedgerEntry> {
    const { currency } = await this.tenancy.currentTenant();
    const entry = await this.entries.insert({
      patientId,
      kind,
      currency,
      createdBy: this.context.requireUserId(),
      ...fields,
    });
    await this.audit.record({
      action: 'ledger_entry.create',
      resourceType: 'ledger_entry',
      resourceId: entry.id,
      after: entry,
      reason: entry.reason ?? undefined,
    });
    const event: LedgerEntryRecorded = this.events.create(LEDGER_ENTRY_RECORDED, {
      entryId: entry.id,
      patientId,
      kind,
    });
    await this.events.publish(event);
    return entry;
  }

  private async requirePatient(patientId: string): Promise<void> {
    const [patient] = await this.patients.getMany([patientId]);
    if (!patient) throw new PatientNotFoundError(NOT_FOUND);
  }

  private async balanceIn(patientId: string): Promise<PatientBalance> {
    return { patientId, balances: sumBalances(await this.entries.sumsByPatient([patientId])) };
  }

  /**
   * The contract only refuses obviously-future dates (it knows UTC, not the tenant); the tenant's
   * today in its time zone is the source of truth (CLAUDE.md §5).
   */
  private async assertNotAfterToday(date: string, path: string): Promise<void> {
    const { timeZone } = await this.tenancy.currentTenant();
    if (date > localDate(this.clock.now(), timeZone)) {
      const message = 'Date cannot be in the future';
      throw new ValidationFailedError(message, [{ path, code: 'future_date', message }]);
    }
  }
}
