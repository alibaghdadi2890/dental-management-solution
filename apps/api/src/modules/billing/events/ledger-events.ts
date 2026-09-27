import type { LedgerEntryKind } from '@dcm/contracts';
import type { DomainEvent } from '../../../platform/events/domain-event';

/**
 * Events `billing` emits (CLAUDE.md §9: ids and minimal facts, dispatched after commit). The
 * generic audit subscriber records each one.
 */

export const LEDGER_ENTRY_RECORDED = 'LedgerEntryRecorded';
export type LedgerEntryRecorded = DomainEvent<
  typeof LEDGER_ENTRY_RECORDED,
  { entryId: string; patientId: string; kind: LedgerEntryKind }
>;
