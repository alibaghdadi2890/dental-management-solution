import type { PaymentMethod } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { SplitHistory } from '../domain/service-split';

/** A visit-kind ledger entry dated in a window (feature 19). */
export interface VisitEntryRow {
  id: string;
  visitId: string;
  kind: 'visit_charge' | 'visit_charge_adjustment' | 'visit_charge_reversal';
  amount: string;
  effectiveDate: string;
}

/** Payments in a window by paid month and method: payments not voided, and refunds. */
export interface PaymentTotalRow {
  month: string;
  method: PaymentMethod;
  payments: string;
  refunds: string;
}

/** Which payments a total counts (the Transactions filters, resolved). */
export interface PaymentWindow {
  from?: string | undefined;
  to?: string | undefined;
  branchId?: string | undefined;
}

const uuids = (ids: readonly string[]) => sql`${sql.param([...ids])}::uuid[]`;
const NOT_VOIDED = sql`not exists (
  select 1 from payments v where v.reverses_payment_id = p.id and v.kind::text = 'void'
)`;

function paymentConditions(window: PaymentWindow, currency: string): SQL {
  const parts: SQL[] = [sql`p.currency = ${currency}`];
  if (window.from !== undefined) parts.push(sql`p.paid_at >= ${window.from}::date`);
  if (window.to !== undefined) parts.push(sql`p.paid_at <= ${window.to}::date`);
  if (window.branchId !== undefined) parts.push(sql`p.branch_id = ${window.branchId}::uuid`);
  return sql.join(parts, sql` and `);
}

/**
 * Read-only sums of `billing`'s tables for the dashboards and the drill-down totals (feature 19,
 * ADR-0087). RLS through `TenantDb`; amounts are summed by Postgres on `numeric`.
 */
@Injectable()
export class BillingSummaryRepository {
  constructor(private readonly db: TenantDb) {}

  /** Visit-kind entries with `effective_date` in [from, to], in `currency`. */
  async visitEntries(
    span: { from: string; to: string },
    currency: string,
  ): Promise<VisitEntryRow[]> {
    const { rows } = await this.db.run((tx) =>
      tx.execute<{
        id: string;
        visit_id: string;
        kind: VisitEntryRow['kind'];
        amount: string;
        effective_date: string;
      }>(sql`
        select e.id, e.visit_id, e.kind::text as kind, e.amount::text as amount,
          e.effective_date::text as effective_date
        from ledger_entries e
        where e.visit_id is not null and e.currency = ${currency}
          and e.effective_date between ${span.from}::date and ${span.to}::date`),
    );
    return rows.map((row) => ({
      id: row.id,
      visitId: row.visit_id,
      kind: row.kind,
      amount: row.amount,
      effectiveDate: row.effective_date,
    }));
  }

  /** The visits among `visitIds` that were ever reversed (voided). */
  async reversedVisits(visitIds: readonly string[]): Promise<Set<string>> {
    if (visitIds.length === 0) return new Set();
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ visit_id: string }>(sql`
        select distinct e.visit_id from ledger_entries e
        where e.kind::text = 'visit_charge_reversal' and e.visit_id = any(${uuids(visitIds)})`),
    );
    return new Set(rows.map((row) => row.visit_id));
  }

  /** Every visit entry of `visitIds` in order, with its lines (code, name, final price). */
  async linedHistories(visitIds: readonly string[]): Promise<SplitHistory[]> {
    if (visitIds.length === 0) return [];
    const { rows } = await this.db.run((tx) =>
      tx.execute<{
        visit_id: string;
        entry_id: string;
        amount: string;
        code: string | null;
        name: string | null;
        line_amount: string | null;
      }>(sql`
        select e.visit_id, e.id as entry_id, e.amount::text as amount, l.code, l.name,
          l.amount::text as line_amount
        from ledger_entries e
        left join ledger_entry_lines l on l.entry_id = e.id
        where e.visit_id = any(${uuids(visitIds)})
        order by e.visit_id, e.created_at, e.id, l.position`),
    );
    const byVisit = new Map<
      string,
      {
        entries: {
          id: string;
          amount: string;
          lines: SplitHistory['entries'][number]['lines'][number][];
        }[];
      }
    >();
    for (const row of rows) {
      const history = byVisit.get(row.visit_id) ?? { entries: [] };
      byVisit.set(row.visit_id, history);
      let entry = history.entries.at(-1);
      if (entry?.id !== row.entry_id) {
        entry = { id: row.entry_id, amount: row.amount, lines: [] };
        history.entries.push(entry);
      }
      if (row.code !== null && row.name !== null && row.line_amount !== null) {
        entry.lines.push({ code: row.code, name: row.name, amount: row.line_amount });
      }
    }
    return [...byVisit.values()];
  }

  /** Payments (not voided) and refunds by paid month and method. */
  async paymentTotals(window: PaymentWindow, currency: string): Promise<PaymentTotalRow[]> {
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ month: string; method: PaymentMethod; payments: string; refunds: string }>(sql`
        select to_char(p.paid_at, 'YYYY-MM') as month, p.method::text as method,
          coalesce(sum(p.amount) filter (where p.kind::text = 'payment' and ${NOT_VOIDED}), 0)::text
            as payments,
          coalesce(sum(p.amount) filter (where p.kind::text = 'refund'), 0)::text as refunds
        from payments p
        where ${paymentConditions(window, currency)}
        group by 1, 2`),
    );
    return rows;
  }
}
