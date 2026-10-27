import type {
  Adjustment,
  Agreement,
  CompensationStatement,
  Payout,
  StatementLine,
} from '@dcm/contracts';
import { agreementsOverlapping, statusOf } from '../domain/agreements';
import { firstDay, lastDay } from '../domain/months';
import type { StoredAgreement } from '../persistence/agreements.repository';
import type { StoredAdjustment, StoredPayout } from '../persistence/money-rows.repository';
import type { DentistMonth } from './statement-reader';

export function toAgreement(agreement: StoredAgreement, today: string): Agreement {
  return {
    id: agreement.id,
    profileId: agreement.profileId,
    preset: agreement.preset,
    components: agreement.components,
    effectiveFrom: agreement.effectiveFrom,
    effectiveTo: agreement.effectiveTo,
    statementVisibleToDentist: agreement.statementVisibleToDentist,
    note: agreement.note,
    status: statusOf(agreement, today),
    createdAt: agreement.createdAt.toISOString(),
    endReason: agreement.endReason,
    supersededAt: agreement.supersededAt?.toISOString() ?? null,
    supersedeReason: agreement.supersedeReason,
  };
}

export function toAdjustment(row: StoredAdjustment): Adjustment {
  return {
    id: row.id,
    profileId: row.profileId,
    kind: row.kind,
    amount: row.amount,
    currency: row.currency,
    date: row.date,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
  };
}

export function toPayout(row: StoredPayout): Payout {
  return {
    id: row.id,
    profileId: row.profileId,
    amount: row.amount,
    currency: row.currency,
    date: row.date,
    method: row.method,
    reference: row.reference,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
  };
}

/** Every line of the month, wherever it is shown. */
export function linesOf(month: DentistMonth): StatementLine[] {
  return [
    ...month.view.earned.flatMap((group) => group.lines),
    ...month.view.late.flatMap((group) => group.lines),
    ...month.view.noAgreement,
    ...month.view.notComputed,
  ];
}

/** The statement as read: the month's lines with patient names, its agreements and money rows. */
export function toStatement(
  month: DentistMonth,
  context: {
    dentistName: string;
    currency: string;
    today: string;
    patientNames: ReadonlyMap<string, string>;
  },
): CompensationStatement {
  const named = (line: StatementLine): StatementLine => ({
    ...line,
    patientName:
      line.patientId === null ? null : (context.patientNames.get(line.patientId) ?? null),
  });
  const agreements = agreementsOverlapping(
    month.agreements,
    firstDay(month.month),
    lastDay(month.month),
  );
  return {
    profileId: month.profileId,
    dentistName: context.dentistName,
    month: month.month,
    status: month.status,
    currency: context.currency,
    agreements: agreements.map((agreement) => toAgreement(agreement, context.today)),
    earned: month.view.earned.map((group) => ({ ...group, lines: group.lines.map(named) })),
    late: month.view.late.map((group) => ({ ...group, lines: group.lines.map(named) })),
    adjustments: month.adjustments.map(toAdjustment),
    payouts: month.payouts.map(toPayout),
    noAgreement: month.view.noAgreement.map(named),
    notComputed: month.view.notComputed.map(named),
    totals: month.view.totals,
    closedAt: month.closedAt?.toISOString() ?? null,
    firstMonth: month.firstMonth,
  };
}
