/** Calendar months (`YYYY-MM`) and dates (`YYYY-MM-DD`) as strings; pure, no time zone. */

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

function parts(month: string): [number, number] {
  const [year, monthIndex] = month.split('-').map(Number);
  return [year ?? 0, monthIndex ?? 1];
}

function format(year: number, monthIndex: number): string {
  return `${String(year).padStart(4, '0')}-${String(monthIndex).padStart(2, '0')}`;
}

export function nextMonth(month: string): string {
  const [year, monthIndex] = parts(month);
  return monthIndex === 12 ? format(year + 1, 1) : format(year, monthIndex + 1);
}

export function previousMonth(month: string): string {
  const [year, monthIndex] = parts(month);
  return monthIndex === 1 ? format(year - 1, 12) : format(year, monthIndex - 1);
}

export function daysInMonth(month: string): number {
  const [year, monthIndex] = parts(month);
  return new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
}

export function firstDay(month: string): string {
  return `${month}-01`;
}

export function lastDay(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
}

/** The months from `from` to `to`, both included; empty when `to` is before `from`. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = from; month <= to; month = nextMonth(month)) months.push(month);
  return months;
}

/** `date − 1 day`. */
export function dayBefore(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) - 1)).toISOString().slice(0, 10);
}

/** `date + 1 day`. */
export function dayAfter(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 1)).toISOString().slice(0, 10);
}

/** Days from `from` to `to`, both included (0 when `to` is before `from`). */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return end < start ? 0 : Math.round((end - start) / 86_400_000) + 1;
}
