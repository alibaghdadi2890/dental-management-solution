import {
  type EarnedGroup,
  fromCents,
  type LateGroup,
  type StatementLine,
  type StatementTotals,
} from '@dcm/contracts';
import type { MonthResult } from './compute';

/**
 * A closed month as frozen (ADR-0059): its lines and totals exactly as computed at the close, and
 * the report's figures. Patient names are not stored — they are looked up when read. The
 * adjustments and payouts of a closed month cannot change, so they are read from their tables.
 */
export interface PeriodSnapshot {
  version: 1;
  earned: EarnedGroup[];
  late: LateGroup[];
  noAgreement: StatementLine[];
  notComputed: StatementLine[];
  totals: StatementTotals;
  report: { visits: number; production: string; collections: string; hasAgreement: boolean };
}

export function snapshotOf(result: MonthResult): PeriodSnapshot {
  return {
    version: 1,
    earned: result.earned,
    late: result.late,
    noAgreement: result.noAgreement,
    notComputed: result.notComputed,
    totals: result.totals,
    report: {
      visits: result.report.visits,
      production: fromCents(result.report.production),
      collections: fromCents(result.report.collections),
      hasAgreement: result.report.hasAgreement,
    },
  };
}
