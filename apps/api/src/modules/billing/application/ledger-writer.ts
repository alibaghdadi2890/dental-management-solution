import { Injectable } from '@nestjs/common';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import { AuditService } from '../../audit';
import type { LedgerEntry, LedgerEntryLine } from '../domain/ledger-entry';
import { LEDGER_ENTRY_RECORDED, type LedgerEntryRecorded } from '../events/ledger-events';
import {
  LedgerEntriesRepository,
  type NewLedgerEntry,
} from '../persistence/ledger-entries.repository';

/**
 * The one write path of a ledger entry: inserts it (with a visit charge's lines), audits
 * `ledger_entry.create` in the same transaction and publishes `LedgerEntryRecorded`, which is
 * dispatched after commit. Internal to `billing` and not permission-gated: `BillingService`
 * checks `payment:write` first, and the visit charge is the system's reaction to a completion the
 * caller was allowed to make (ADR-0024). Callers hold the patient `FOR SHARE`
 * (`PatientsService.lockForDependentWrite`) in the transaction this joins.
 */
@Injectable()
export class LedgerWriter {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly entries: LedgerEntriesRepository,
  ) {}

  append(entry: NewLedgerEntry, lines: readonly LedgerEntryLine[] = []): Promise<LedgerEntry> {
    return this.tenantDb.run(async () => {
      const recorded = await this.entries.insert(entry);
      await this.entries.insertLines(recorded.id, lines);
      await this.audit.record({
        action: 'ledger_entry.create',
        resourceType: 'ledger_entry',
        resourceId: recorded.id,
        after: lines.length === 0 ? recorded : { ...recorded, lines },
        reason: recorded.reason ?? undefined,
      });
      const event: LedgerEntryRecorded = this.events.create(LEDGER_ENTRY_RECORDED, {
        entryId: recorded.id,
        patientId: recorded.patientId,
        kind: recorded.kind,
      });
      await this.events.publish(event);
      return recorded;
    });
  }
}
