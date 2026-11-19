/** The periods the reports and statements offer, resolved on the clinic's today. */
export const PERIODS = ['this_month', 'last_month', 'last_3_months', 'this_year'] as const;
export type Period = (typeof PERIODS)[number];

export function periodSpan(period: Period, today: string): { from: string; to: string } {
  const [year, month] = today.split('-').map(Number) as [number, number];
  const first = (y: number, m: number) =>
    new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
  const last = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  if (period === 'this_month') return { from: first(year, month), to: today };
  if (period === 'last_month') return { from: first(year, month - 1), to: last(year, month - 1) };
  if (period === 'last_3_months') return { from: first(year, month - 2), to: today };
  return { from: `${String(year)}-01-01`, to: today };
}
