import type { AgingBucket } from '@dcm/contracts';

/**
 * Receivables aging (B10, P13): each charge's unpaid remainder ages from the charge's date (an
 * opening balance from its as-of date) on the tenant's today. Pure; dates are `YYYY-MM-DD`.
 */

const DAY_MS = 86_400_000;

/** Whole days from `date` to `today` (0 on the day itself; never negative). */
export function daysSince(date: string, today: string): number {
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS,
  );
  return days > 0 ? days : 0;
}

/** `date` plus `days` (negative goes back), on the calendar. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days))
    .toISOString()
    .slice(0, 10);
}

export function agingBucket(date: string, today: string): AgingBucket {
  const days = daysSince(date, today);
  if (days <= 30) return 'd0_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90_plus';
}

export interface Remainder {
  patientId: string;
  date: string;
  amount: bigint;
}

/**
 * Σ remainder per bucket, and the patients whose **oldest** remainder is in it (the Outstanding
 * filter's rule, P13, so a bucket's count matches its list); every bucket present, in order.
 */
export function agingTotals(
  remainders: readonly Remainder[],
  today: string,
): { bucket: AgingBucket; amount: bigint; patients: number }[] {
  const order: AgingBucket[] = ['d0_30', 'd31_60', 'd61_90', 'd90_plus'];
  const amounts = new Map(order.map((bucket) => [bucket, 0n]));
  const oldest = new Map<string, string>();
  for (const remainder of remainders) {
    if (remainder.amount <= 0n) continue;
    const bucket = agingBucket(remainder.date, today);
    amounts.set(bucket, (amounts.get(bucket) ?? 0n) + remainder.amount);
    const seen = oldest.get(remainder.patientId);
    if (seen === undefined || remainder.date < seen)
      oldest.set(remainder.patientId, remainder.date);
  }
  const patients = new Map(order.map((bucket) => [bucket, 0]));
  for (const date of oldest.values()) {
    const bucket = agingBucket(date, today);
    patients.set(bucket, (patients.get(bucket) ?? 0) + 1);
  }
  return order.map((bucket) => ({
    bucket,
    amount: amounts.get(bucket) ?? 0n,
    patients: patients.get(bucket) ?? 0,
  }));
}
