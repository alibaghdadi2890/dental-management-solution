import { fromCents, type LedgerEntryKind, type PaymentMethod, toCents } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { AllocationPair, NewAllocation } from '../domain/allocate';
import type { AccountSource, AccountTarget, AllocatedLine } from '../domain/payment';
import { paymentAllocations } from './schema';

interface TargetRow extends Record<string, unknown> {
  id: string;
  patient_id: string;
  kind: LedgerEntryKind;
  visit_id: string | null;
  date: string;
  created_ms: string;
  currency: string;
  net: string;
  allocated: string;
}

interface SourceRow extends Record<string, unknown> {
  id: string;
  patient_id: string;
  kind: LedgerEntryKind;
  date: string;
  created_ms: string;
  currency: string;
  capacity: string;
}

interface PairRow extends Record<string, unknown> {
  source_entry_id: string;
  target_entry_id: string;
  amount: string;
  ord: string;
}

interface LineRow extends Record<string, unknown> {
  source_entry_id: string;
  target_entry_id: string;
  patient_id: string;
  kind: LedgerEntryKind;
  visit_id: string | null;
  date: string;
  amount: string;
}

const uuids = (ids: readonly string[]) => sql`${sql.param([...ids])}::uuid[]`;

/**
 * The charges of the tenant's accounts (P2), with what is allocated to each — one definition,
 * used by settle, the payment panel, aging and the outstanding list:
 * - an `opening_balance` or `adjustment` above zero is its own target;
 * - a visit is one target: its `visit_charge` (else its first entry — a visit charged 0 then
 *   amended up), netted with every entry of the visit.
 * `scope` narrows the entries (always a condition on `e`, a `ledger_entries` alias).
 */
function targetsQuery(scope: SQL): SQL {
  return sql`
    with visit_entries as (
      select e.id, e.patient_id, e.kind, e.visit_id, e.effective_date, e.created_at, e.currency,
        row_number() over (
          partition by e.visit_id
          order by (e.kind::text <> 'visit_charge'), e.created_at, e.id
        ) as rn,
        sum(e.amount) over (partition by e.visit_id) as visit_net
      from ledger_entries e
      where e.visit_id is not null and ${scope}
    ),
    targets as (
      select e.id, e.patient_id, e.kind, e.visit_id, e.effective_date, e.created_at, e.currency,
        e.amount as net
      from ledger_entries e
      where e.kind::text in ('opening_balance', 'adjustment') and e.amount > 0 and ${scope}
      union all
      select v.id, v.patient_id, v.kind, v.visit_id, v.effective_date, v.created_at, v.currency,
        v.visit_net
      from visit_entries v
      where v.rn = 1
    )
    select t.id, t.patient_id, t.kind, t.visit_id, t.effective_date::text as date,
      (extract(epoch from t.created_at) * 1000)::bigint::text as created_ms, t.currency,
      t.net::text as net,
      coalesce((
        select sum(a.amount) from payment_allocations a where a.target_entry_id = t.id
      ), 0)::text as allocated
    from targets t`;
}

function toTarget(row: TargetRow): AccountTarget {
  return {
    entryId: row.id,
    patientId: row.patient_id,
    kind: row.kind,
    visitId: row.visit_id,
    date: row.date,
    createdAt: Number(row.created_ms),
    currency: row.currency,
    net: toCents(row.net),
    allocated: toCents(row.allocated),
  };
}

/**
 * `payment_allocations` and the account reads built on the ledger (RLS-scoped through
 * `TenantDb`). Rows are append-only; a release is a negative row. Amounts leave as cents.
 */
@Injectable()
export class AllocationsRepository {
  constructor(private readonly db: TenantDb) {}

  async insert(rows: readonly NewAllocation[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.run((tx) =>
      tx.insert(paymentAllocations).values(
        rows.map((row) => ({
          sourceEntryId: row.sourceId,
          targetEntryId: row.targetId,
          amount: fromCents(row.amount),
          kind: row.kind,
          manual: row.manual,
        })),
      ),
    );
  }

  /** Every target of `patientIds` (any outstanding), in no particular order. */
  async targetsOf(patientIds: readonly string[]): Promise<AccountTarget[]> {
    if (patientIds.length === 0) return [];
    const { rows } = await this.db.run((tx) =>
      tx.execute<TargetRow>(targetsQuery(sql`e.patient_id = any(${uuids(patientIds)})`)),
    );
    return rows.map(toTarget);
  }

  /** Every target of the tenant in `currency` with something still owed. */
  async openTargets(currency: string): Promise<AccountTarget[]> {
    const { rows } = await this.db.run((tx) =>
      tx.execute<TargetRow>(
        sql`select * from (${targetsQuery(sql`e.currency = ${currency}`)}) o
            where greatest(o.net::numeric, 0) - o.allocated::numeric > 0`,
      ),
    );
    return rows.map(toTarget);
  }

  /**
   * The sources of `patientIds`: payments (capacity = amount − refunds − voids) and credit
   * entries (`opening_balance` / `adjustment` below zero).
   */
  async sourcesOf(patientIds: readonly string[]): Promise<AccountSource[]> {
    if (patientIds.length === 0) return [];
    const { rows } = await this.db.run((tx) =>
      tx.execute<SourceRow>(sql`
        select e.id, e.patient_id, e.kind, e.effective_date::text as date,
          (extract(epoch from e.created_at) * 1000)::bigint::text as created_ms, e.currency,
          (case when e.kind::text = 'payment'
            then greatest(-e.amount - coalesce((
              select sum(r.amount) from payments r where r.reverses_payment_id = p.id
            ), 0), 0)
            else -e.amount end)::text as capacity
        from ledger_entries e
        left join payments p on p.ledger_entry_id = e.id
        where e.patient_id = any(${uuids(patientIds)})
          and (e.kind::text = 'payment'
            or (e.kind::text in ('opening_balance', 'adjustment') and e.amount < 0))`),
    );
    return rows.map((row) => ({
      entryId: row.id,
      patientId: row.patient_id,
      kind: row.kind,
      date: row.date,
      createdAt: Number(row.created_ms),
      currency: row.currency,
      capacity: toCents(row.capacity),
    }));
  }

  /** The current allocation per (source, target) of the sources of `patientIds`. */
  async pairsOf(patientIds: readonly string[]): Promise<AllocationPair[]> {
    if (patientIds.length === 0) return [];
    const { rows } = await this.db.run((tx) =>
      tx.execute<PairRow>(sql`
        select a.source_entry_id, a.target_entry_id, sum(a.amount)::text as amount,
          max(a.seq)::text as ord
        from payment_allocations a
        join ledger_entries s on s.id = a.source_entry_id
        where s.patient_id = any(${uuids(patientIds)})
        group by a.source_entry_id, a.target_entry_id`),
    );
    return rows.map((row) => ({
      sourceId: row.source_entry_id,
      targetId: row.target_entry_id,
      amount: toCents(row.amount),
      order: Number(row.ord),
    }));
  }

  /**
   * What `sourceIds` currently cover (pairs above zero), with the targets' details. With
   * `originalOnly`, what they covered when written (their `allocation` rows: a receipt).
   */
  async linesOfSources(
    sourceIds: readonly string[],
    originalOnly = false,
  ): Promise<AllocatedLine[]> {
    if (sourceIds.length === 0) return [];
    const { rows } = await this.db.run((tx) =>
      tx.execute<LineRow>(sql`
        select a.source_entry_id, a.target_entry_id, t.patient_id, t.kind, t.visit_id,
          t.effective_date::text as date, sum(a.amount)::text as amount
        from payment_allocations a
        join ledger_entries t on t.id = a.target_entry_id
        where a.source_entry_id = any(${uuids(sourceIds)})
          and (${!originalOnly} or a.kind::text = 'allocation')
        group by a.source_entry_id, a.target_entry_id, t.patient_id, t.kind, t.visit_id,
          t.effective_date, t.created_at
        having sum(a.amount) > 0
        order by t.effective_date, t.created_at, a.target_entry_id`),
    );
    return rows.map((row) => ({
      sourceId: row.source_entry_id,
      targetId: row.target_entry_id,
      patientId: row.patient_id,
      kind: row.kind,
      visitId: row.visit_id,
      date: row.date,
      amount: toCents(row.amount),
    }));
  }

  /**
   * Per visit among `visitIds`: Σ allocated to its target (`all`) and the part coming from
   * payments (`payments`: what blocks a void, P8). Visits without allocations are absent.
   */
  async allocatedToVisits(
    visitIds: readonly string[],
  ): Promise<Map<string, { all: bigint; payments: bigint }>> {
    if (visitIds.length === 0) return new Map();
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ visit_id: string; total: string; payments: string }>(sql`
        select t.visit_id, sum(a.amount)::text as total,
          coalesce(sum(a.amount) filter (where s.kind::text = 'payment'), 0)::text as payments
        from payment_allocations a
        join ledger_entries t on t.id = a.target_entry_id
        join ledger_entries s on s.id = a.source_entry_id
        where t.visit_id = any(${uuids(visitIds)})
        group by t.visit_id`),
    );
    return new Map(
      rows.map((row) => [
        row.visit_id,
        { all: toCents(row.total), payments: toCents(row.payments) },
      ]),
    );
  }

  /** The payments that currently cover `visitId`, oldest first, with what each covers (invoice). */
  async paymentsForVisit(visitId: string): Promise<
    {
      paymentId: string;
      receiptNumber: number;
      paidAt: string;
      method: PaymentMethod;
      amount: string;
    }[]
  > {
    const { rows } = await this.db.run((tx) =>
      tx.execute<{
        id: string;
        receipt_number: number;
        paid_at: string;
        method: PaymentMethod;
        amount: string;
      }>(sql`
        select p.id, p.receipt_number, p.paid_at::text as paid_at, p.method,
          sum(a.amount)::text as amount
        from payment_allocations a
        join ledger_entries t on t.id = a.target_entry_id
        join payments p on p.ledger_entry_id = a.source_entry_id
        where t.visit_id = ${visitId}
        group by p.id, p.receipt_number, p.paid_at, p.method
        having sum(a.amount) > 0
        order by p.paid_at, p.id`),
    );
    return rows.map((row) => ({
      paymentId: row.id,
      receiptNumber: row.receipt_number,
      paidAt: row.paid_at,
      method: row.method,
      amount: fromCents(toCents(row.amount)),
    }));
  }

  /** The payments that covered any of `visitIds` (the Transactions visit search). */
  async paymentIdsForVisits(visitIds: readonly string[]): Promise<string[]> {
    if (visitIds.length === 0) return [];
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ id: string }>(sql`
        select distinct p.id
        from payment_allocations a
        join ledger_entries t on t.id = a.target_entry_id
        join payments p on p.ledger_entry_id = a.source_entry_id
        where t.visit_id = any(${uuids(visitIds)})`),
    );
    return rows.map((row) => row.id);
  }

  /** Visits whose entries still sum above what is allocated to them, in id order (Unpaid). */
  async visitIdsOwing(): Promise<string[]> {
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ visit_id: string }>(sql`
        select o.visit_id from (${targetsQuery(sql`true`)}) o
        where o.visit_id is not null and o.net::numeric - o.allocated::numeric > 0
        order by o.visit_id`),
    );
    return rows.map((row) => row.visit_id);
  }
}
