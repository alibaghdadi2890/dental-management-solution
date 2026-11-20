/** What the fair order reads of an entry (B3, ADR-0105). */
export interface OrderedEntry {
  id: string;
  urgent: boolean;
  /** A call was attempted today (clinic-local): it goes after those not tried today. */
  triedToday: boolean;
  createdAt: Date;
}

/**
 * *Urgent* first; then those not tried today; then whoever has waited longest. The uuid v7 id
 * breaks a tie, as it follows the application's clock and not the database's.
 */
export function compareFair(a: OrderedEntry, b: OrderedEntry): number {
  return (
    Number(b.urgent) - Number(a.urgent) ||
    Number(a.triedToday) - Number(b.triedToday) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}
