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

/** A visit's charge as charged: the net amount and its lines (code, final price), in order. */
export interface VisitChargeLines {
  visitId: string;
  net: string;
  currency: string;
  lines: { code: string; amount: string }[];
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

  async chargeLines(visitIds: readonly string[]): Promise<VisitChargeLines[]> {
    if (visitIds.length === 0) return [];
    const { rows } = await this.db.run((tx) =>
      tx.execute<{
        visit_id: string;
        net: string;
        currency: string;
        code: string | null;
        line_amount: string | null;
      }>(sql`
        select e.visit_id, e.amount::text as net, e.currency, l.code, l.amount::text as line_amount
        from ledger_entries e
        left join ledger_entry_lines l on l.entry_id = e.id
        where e.kind::text = 'visit_charge' and e.visit_id = any(${uuids(visitIds)})
        order by e.visit_id, l.position`),
    );
    const byVisit = new Map<string, VisitChargeLines>();
    for (const row of rows) {
      const charge = byVisit.get(row.visit_id) ?? {
        visitId: row.visit_id,
        net: row.net,
        currency: row.currency,
        lines: [],
      };
      if (row.code !== null && row.line_amount !== null) {
        charge.lines.push({ code: row.code, amount: row.line_amount });
      }
      byVisit.set(row.visit_id, charge);
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
