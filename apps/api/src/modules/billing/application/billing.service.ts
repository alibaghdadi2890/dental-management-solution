import type {
  AdjustmentInput,
  CreateWithOpeningBalance,
  LedgerEntryKind,
  OpeningBalanceInput,
  OpeningBalanceResult,
  Patient,
  PatientBalance,
  Tenant,
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
import { sumBalances } from '../domain/balances';
import type { LedgerEntry } from '../domain/ledger-entry';
import { LEDGER_ENTRY_RECORDED, type LedgerEntryRecorded } from '../events/ledger-events';
import { LedgerEntriesRepository } from '../persistence/ledger-entries.repository';

/** The fields a caller chooses; the kind, currency and creator are set by `append`. */
type EntryFields = Pick<LedgerEntry, 'amount' | 'effectiveDate' | 'note' | 'reason'>;

/**
 * The patient ledger of the current tenant (docs/modules/billing.md): opening balances,
 * adjustments and balances (design Q1, Q12, Q13). Entries are stamped with the tenant currency;
 * every write re-checks `payment:write`, holds the patient row `FOR SHARE`
 * (`PatientsService.lockForLedger`, so a concurrent merge waits for it), is audited in the same
 * transaction and emits `LedgerEntryRecorded` after commit. Patient existence always comes from
 * `PatientsService`, which requires `patient:read` — every system role holds it.
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
    return this.tenantDb.run(async () => {
      const tenant = await this.tenancy.currentTenant();
      this.assertNotAfterToday(input.openingBalance.asOf, tenant, 'openingBalance.asOf');
      const patient = await this.createPatient(input.patient);
      // Just created in this transaction: nobody else can see, merge or archive it yet.
      const entry = await this.appendOpeningBalance(patient.id, input.openingBalance, tenant);
      return { patient, balance: { patientId: patient.id, balances: sumBalances([entry]) } };
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
      await this.patients.lockForLedger(patientId);
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
      await this.patients.lockForLedger(patientId);
      await this.append(patientId, 'adjustment', tenant, {
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
      return known.map((patientId) => ({
        patientId,
        balances: sumBalances(sums.filter((sum) => sum.patientId === patientId)),
      }));
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

  /** Inserts, audits and publishes one entry in the tenant currency. */
  private async append(
    patientId: string,
    kind: LedgerEntryKind,
    tenant: Tenant,
    fields: EntryFields,
  ): Promise<LedgerEntry> {
    const entry = await this.entries.insert({
      patientId,
      kind,
      currency: tenant.currency,
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

  private async balanceIn(patientId: string): Promise<PatientBalance> {
    return { patientId, balances: sumBalances(await this.entries.sumsByPatient([patientId])) };
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
