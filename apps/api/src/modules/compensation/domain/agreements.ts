import type { AgreementComponent, AgreementPreset, AgreementStatus } from '@dcm/contracts';
import { EffectiveDateError, NotReversibleError, PeriodClosedError } from './compensation-errors';
import { dayAfter, dayBefore, monthOf } from './months';

/** An agreement as the domain reads it (ADR-0058). */
export interface AgreementRecord {
  id: string;
  profileId: string;
  preset: AgreementPreset;
  components: AgreementComponent[];
  effectiveFrom: string;
  effectiveTo: string | null;
  statementVisibleToDentist: boolean;
  superseded: boolean;
}

export function isLive(agreement: Pick<AgreementRecord, 'superseded'>): boolean {
  return !agreement.superseded;
}

export function coversDate(agreement: AgreementRecord, date: string): boolean {
  return (
    isLive(agreement) &&
    agreement.effectiveFrom <= date &&
    (agreement.effectiveTo === null || date <= agreement.effectiveTo)
  );
}

/** The live agreement in force on `date` (live agreements never overlap). */
export function agreementOn<T extends AgreementRecord>(
  agreements: readonly T[],
  date: string,
): T | undefined {
  return agreements.find((agreement) => coversDate(agreement, date));
}

/** Live agreements in force on some day between `from` and `to`, oldest first. */
export function agreementsOverlapping<T extends AgreementRecord>(
  agreements: readonly T[],
  from: string,
  to: string,
): T[] {
  return agreements
    .filter(
      (agreement) =>
        isLive(agreement) &&
        agreement.effectiveFrom <= to &&
        (agreement.effectiveTo === null || agreement.effectiveTo >= from),
    )
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
}

export function statusOf(agreement: AgreementRecord, today: string): AgreementStatus {
  if (agreement.superseded) return 'superseded';
  if (agreement.effectiveFrom > today) return 'future';
  if (agreement.effectiveTo !== null && agreement.effectiveTo < today) return 'ended';
  return 'active';
}

/**
 * Closed months are a prefix of the dentist's months (they close in order, ADR-0059), so a date
 * is closed when its month is the last closed month or before it.
 */
export function assertDateOpen(date: string, lastClosed: string | null): void {
  if (lastClosed !== null && monthOf(date) <= lastClosed) {
    throw new PeriodClosedError('That month is closed', { date, lastClosed });
  }
}

/** A new agreement: starts in an open month; overlaps are the database's exclusion constraint. */
export function assertCreatable(
  input: { effectiveFrom: string; effectiveTo: string | null },
  lastClosed: string | null,
): void {
  if (input.effectiveTo !== null && input.effectiveTo < input.effectiveFrom) {
    throw new EffectiveDateError('Ends before it starts');
  }
  assertDateOpen(input.effectiveFrom, lastClosed);
}

/**
 * Ending sets or shortens `effective_to`: never lengthens, never before the start, and the day
 * after the end must be in an open month — ending changes the days after it, and a closed
 * statement never changes (ending on a closed month's last day changes nothing there).
 */
export function assertEndable(
  agreement: AgreementRecord,
  date: string,
  lastClosed: string | null,
): void {
  if (agreement.superseded) throw new NotReversibleError('The agreement was superseded');
  if (date < agreement.effectiveFrom) {
    throw new EffectiveDateError('An agreement cannot end before it starts');
  }
  if (agreement.effectiveTo !== null && date >= agreement.effectiveTo) {
    throw new EffectiveDateError('An agreement is only ever shortened');
  }
  assertDateOpen(dayAfter(date), lastClosed);
}

/**
 * Change terms from `date` (C5, ADR-0058): with no live agreement on `date`, the next one simply
 * starts; on the current agreement's first day it is superseded (allowed while none of its months
 * is closed); later, it ends on `date − 1`. The new agreement keeps the old end, if any.
 */
export type TermsChange<T extends AgreementRecord = AgreementRecord> =
  | { kind: 'start' }
  | { kind: 'supersede'; current: T }
  | { kind: 'end'; current: T; endOn: string };

export function planTermsChange<T extends AgreementRecord>(
  agreements: readonly T[],
  date: string,
  lastClosed: string | null,
): TermsChange<T> {
  assertDateOpen(date, lastClosed);
  const current = agreementOn(agreements, date);
  if (!current) return { kind: 'start' };
  if (current.effectiveFrom === date) {
    assertDateOpen(current.effectiveFrom, lastClosed);
    return { kind: 'supersede', current };
  }
  return { kind: 'end', current, endOn: dayBefore(date) };
}

/**
 * What deactivating the dentist on `date` does (C11): the agreement in force ends on `date`, the
 * ones that start later are superseded. Never refuses — a month only closes once it has ended, so
 * today is never in a closed month.
 */
export function planDeactivation<T extends AgreementRecord>(
  agreements: readonly T[],
  date: string,
): { end: T[]; supersede: T[] } {
  const live = agreements.filter(isLive);
  return {
    end: live.filter(
      (agreement) =>
        agreement.effectiveFrom <= date &&
        (agreement.effectiveTo === null || agreement.effectiveTo > date),
    ),
    supersede: live.filter((agreement) => agreement.effectiveFrom > date),
  };
}
