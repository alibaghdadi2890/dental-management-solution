import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';

/** A visit-kind ledger entry, as `compensation` reads production (ADR-0059). */
export interface VisitEntryFact {
  id: string;
  visitId: string;
  kind: 'visit_charge' | 'visit_charge_adjustment' | 'visit_charge_reversal';
  amount: string;
  currency: string;
  effectiveDate: string;
  createdAt: Date;
}

/**
 * A visit's ledger entries in the order they were made, each with its lines (code, final price):
 * a charge's are the visit as charged, a correction's the visit as it stands after it (ADR-0062);
 * other entries have none.
 */
export interface VisitEntryHistory {
  visitId: string;
  currency: string;
  entries: { id: string; amount: string; lines: { code: string; amount: string }[] }[];
}

/** An allocation row whose source is a `payment` entry and whose target is a visit entry. */
export interface VisitCollectionFact {
  id: string;
  visitId: string;
  kind: 'allocation' | 'credit_applied' | 'release';
  amount: string;
  currency: string;
  createdAt: Date;
}

const uuids = (ids: readonly string[]) => sql`${sql.param([...ids])}::uuid[]`;
const instant = (value: Date) => sql`${value.toISOString()}::timestamptz`;

/**
 * Read-only feeds of the ledger by date, for `compensation`'s statements (ADR-0059). A window is
 * the rows of a period, plus — with `createdSince` — every row created since then whatever its
 * date (the late candidates of a closed month).
 */
@Injectable()
export class VisitMoneyFeedRepository {
  constructor(private readonly db: TenantDb) {}

  async entries(window: {
    from: string;
    to: string;
    createdSince: Date | null;
  }): Promise<VisitEntryFact[]> {
    const late =
      window.createdSince === null
        ? sql`false`
        : sql`e.created_at >= ${instant(window.createdSince)}`;
    const { rows } = await this.db.run((tx) =>
      tx.execute<{
        id: string;
        visit_id: string;
        kind: VisitEntryFact['kind'];
        amount: string;
        currency: string;
        effective_date: string;
        created_ms: string;
      }>(sql`
        select e.id, e.visit_id, e.kind::text as kind, e.amount::text as amount, e.currency,
          e.effective_date::text as effective_date, (extract(epoch from e.created_at) * 1000)::bigint::text as created_ms
        from ledger_entries e
        where e.visit_id is not null
          and (e.effective_date between ${window.from}::date and ${window.to}::date or ${late})`),
    );
    return rows.map((row) => ({
      id: row.id,
      visitId: row.visit_id,
      kind: row.kind,
      amount: row.amount,
      currency: row.currency,
      effectiveDate: row.effective_date,
      createdAt: new Date(Number(row.created_ms)),
    }));
  }

  async entryHistories(visitIds: readonly string[]): Promise<VisitEntryHistory[]> {
    if (visitIds.length === 0) return [];
    const { rows } = await this.db.run((tx) =>
      tx.execute<{
        visit_id: string;
        entry_id: string;
        amount: string;
        currency: string;
        code: string | null;
        line_amount: string | null;
      }>(sql`
        select e.visit_id, e.id as entry_id, e.amount::text as amount, e.currency, l.code,
          l.amount::text as line_amount
        from ledger_entries e
        left join ledger_entry_lines l on l.entry_id = e.id
        where e.visit_id = any(${uuids(visitIds)})
        order by e.visit_id, e.created_at, e.id, l.position`),
    );
    const byVisit = new Map<string, VisitEntryHistory>();
    for (const row of rows) {
      const history = byVisit.get(row.visit_id) ?? {
        visitId: row.visit_id,
        currency: row.currency,
        entries: [],
      };
      byVisit.set(row.visit_id, history);
      let entry = history.entries.at(-1);
      if (entry?.id !== row.entry_id) {
        entry = { id: row.entry_id, amount: row.amount, lines: [] };
        history.entries.push(entry);
      }
      if (row.code !== null && row.line_amount !== null) {
        entry.lines.push({ code: row.code, amount: row.line_amount });
      }
    }
    return [...byVisit.values()];
  }

  async collections(window: {
    from: Date;
    to: Date;
    createdSince: Date | null;
  }): Promise<VisitCollectionFact[]> {
    const late =
      window.createdSince === null
        ? sql`false`
        : sql`a.created_at >= ${instant(window.createdSince)}`;
    const { rows } = await this.db.run((tx) =>
      tx.execute<{
        id: string;
        visit_id: string;
        kind: VisitCollectionFact['kind'];
        amount: string;
        currency: string;
        created_ms: string;
      }>(sql`
        select a.id, t.visit_id, a.kind::text as kind, a.amount::text as amount, s.currency,
          (extract(epoch from a.created_at) * 1000)::bigint::text as created_ms
        from payment_allocations a
        join ledger_entries s on s.id = a.source_entry_id
        join ledger_entries t on t.id = a.target_entry_id
        where s.kind::text = 'payment' and t.visit_id is not null
          and ((a.created_at >= ${instant(window.from)} and a.created_at < ${instant(window.to)}) or ${late})`),
    );
    return rows.map((row) => ({
      id: row.id,
      visitId: row.visit_id,
      kind: row.kind,
      amount: row.amount,
      currency: row.currency,
      createdAt: new Date(Number(row.created_ms)),
    }));
  }

  async unattributedCollections(window: {
    from: Date;
    to: Date;
  }): Promise<{ currency: string; amount: string }[]> {
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ currency: string; amount: string }>(sql`
        select s.currency, sum(a.amount)::text as amount
        from payment_allocations a
        join ledger_entries s on s.id = a.source_entry_id
        join ledger_entries t on t.id = a.target_entry_id
        where s.kind::text = 'payment' and t.visit_id is null
          and a.created_at >= ${instant(window.from)} and a.created_at < ${instant(window.to)}
        group by s.currency`),
    );
    return rows;
  }
}
