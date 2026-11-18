import type { PlanPriority, VisitType } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';

/** Which visits a summary counts: local dates (both ends included), a branch, a dentist. */
export interface VisitWindow {
  from: string;
  to: string;
  branchId?: string | undefined;
  dentistId?: string | undefined;
}

/** A finished, non-imported visit, for the dashboard's waits and lengths (feature 19). */
export interface FinishedVisitRow {
  id: string;
  type: VisitType;
  appointmentId: string | null;
  dentistId: string;
  startedAt: Date;
  durationMinutes: number | null;
  localDate: string;
}

/** A plan item's stages, per dentist (feature 19). */
export interface PlanStageRow {
  dentistId: string;
  recorded: number;
  accepted: number;
  started: number;
  completed: number;
}

const uuids = (ids: readonly string[]) => sql`${sql.param([...ids])}::uuid[]`;
const COUNTED = sql.raw(`('completed', 'amended')`);
const LIVE = sql.raw(`('in_progress', 'paused')`);

function filters(window: { branchId?: string | undefined; dentistId?: string | undefined }) {
  const parts: SQL[] = [];
  if (window.branchId !== undefined) parts.push(sql` and v.branch_id = ${window.branchId}::uuid`);
  if (window.dentistId !== undefined) {
    parts.push(sql` and v.dentist_id = ${window.dentistId}::uuid`);
  }
  return sql.join(parts, sql``);
}

/** Each patient's first counted visit ever (imported ones included), with its branch and dentist. */
const FIRST_VISITS = sql`
  select distinct on (v.patient_id) v.patient_id, v.local_date, v.branch_id, v.dentist_id
  from visits v
  where v.status in ${COUNTED}
  order by v.patient_id, v.local_date, v.started_at, v.id`;

/**
 * Read-only aggregates of `clinical`'s tables for the dashboards (feature 19, ADR-0087). Every
 * query runs under RLS through `TenantDb`; none reads another module's table.
 */
@Injectable()
export class ClinicalSummaryRepository {
  constructor(private readonly db: TenantDb) {}

  async visitFacts(ids: readonly string[]): Promise<
    {
      id: string;
      branchId: string;
      dentistId: string;
      status: string;
      imported: boolean;
    }[]
  > {
    if (ids.length === 0) return [];
    const { rows } = await this.db.run((tx) =>
      tx.execute<{
        id: string;
        branch_id: string;
        dentist_id: string;
        status: string;
        imported: boolean;
      }>(sql`
        select v.id, v.branch_id, v.dentist_id, v.status::text as status,
          v.imported_at is not null as imported
        from visits v where v.id = any(${uuids(ids)})`),
    );
    return rows.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      dentistId: row.dentist_id,
      status: row.status,
      imported: row.imported,
    }));
  }

  /** Per visit: Σ line base prices (gross) and Σ line discounts + the visit discount. */
  async discountFacts(
    ids: readonly string[],
  ): Promise<{ id: string; gross: string; discount: string }[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ id: string; gross: string; discount: string }>(sql`
        select v.id,
          coalesce(sum(s.base_amount), 0)::text as gross,
          (coalesce(sum(s.discount_amount), 0) + coalesce(v.discount_amount, 0))::text as discount
        from visits v
        left join visit_services s on s.visit_id = v.id and s.deleted_at is null
        where v.id = any(${uuids(ids)})
        group by v.id, v.discount_amount`),
    );
    return rows;
  }

  /** Finished (completed or corrected), non-imported visits in the window, per month. */
  async finishedByMonth(window: VisitWindow): Promise<{ month: string; count: number }[]> {
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ month: string; total: string }>(sql`
        select to_char(v.local_date, 'YYYY-MM') as month, count(*)::text as total
        from visits v
        where v.status in ${COUNTED} and v.imported_at is null
          and v.local_date between ${window.from}::date and ${window.to}::date ${filters(window)}
        group by 1`),
    );
    return rows.map((row) => ({ month: row.month, count: Number(row.total) }));
  }

  async finishedCount(window: VisitWindow): Promise<number> {
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ total: string }>(sql`
        select count(*)::text as total from visits v
        where v.status in ${COUNTED} and v.imported_at is null
          and v.local_date between ${window.from}::date and ${window.to}::date ${filters(window)}`),
    );
    return Number(rows[0]?.total ?? 0);
  }

  async finishedVisits(window: VisitWindow): Promise<FinishedVisitRow[]> {
    const { rows } = await this.db.run((tx) =>
      tx.execute<{
        id: string;
        type: VisitType;
        appointment_id: string | null;
        dentist_id: string;
        started_ms: string;
        duration_minutes: number | null;
        local_date: string;
      }>(sql`
        select v.id, v.type::text as type, v.appointment_id, v.dentist_id,
          (extract(epoch from v.started_at) * 1000)::bigint::text as started_ms,
          v.duration_minutes, v.local_date::text as local_date
        from visits v
        where v.status in ${COUNTED} and v.imported_at is null
          and v.local_date between ${window.from}::date and ${window.to}::date ${filters(window)}`),
    );
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      appointmentId: row.appointment_id,
      dentistId: row.dentist_id,
      startedAt: new Date(Number(row.started_ms)),
      durationMinutes: row.duration_minutes,
      localDate: row.local_date,
    }));
  }

  /** Patients whose first visit ever is in the window (its branch and dentist matching). */
  async firstSeen(window: VisitWindow): Promise<{ patientId: string; date: string }[]> {
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ patient_id: string; local_date: string }>(sql`
        select v.patient_id, v.local_date::text as local_date from (${FIRST_VISITS}) v
        where v.local_date between ${window.from}::date and ${window.to}::date ${filters(window)}`),
    );
    return rows.map((row) => ({ patientId: row.patient_id, date: row.local_date }));
  }

  /**
   * Distinct (month, patient) pairs of counted visits in the window; `imported: false` leaves
   * imported visits out (a period's activity), `true` keeps them (who is active).
   */
  async seenByMonth(
    window: VisitWindow,
    imported: boolean,
  ): Promise<{ month: string; patientId: string }[]> {
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ month: string; patient_id: string }>(sql`
        select distinct to_char(v.local_date, 'YYYY-MM') as month, v.patient_id
        from visits v
        where v.status in ${COUNTED} ${imported ? sql`` : sql`and v.imported_at is null`}
          and v.local_date between ${window.from}::date and ${window.to}::date ${filters(window)}`),
    );
    return rows.map((row) => ({ month: row.month, patientId: row.patient_id }));
  }

  /** Patients with a counted visit (imported included) in the window. */
  async seenIds(window: VisitWindow): Promise<string[]> {
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ patient_id: string }>(sql`
        select distinct v.patient_id from visits v
        where v.status in ${COUNTED}
          and v.local_date between ${window.from}::date and ${window.to}::date ${filters(window)}`),
    );
    return rows.map((row) => row.patient_id);
  }

  /** Of the patients first seen in the window, how many had a later counted visit. */
  async cameBack(window: VisitWindow): Promise<{ cohort: number; returned: number }> {
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ cohort: string; returned: string }>(sql`
        select count(*)::text as cohort,
          count(*) filter (where exists (
            select 1 from visits later
            where later.patient_id = v.patient_id and later.status in ${COUNTED}
              and later.local_date > v.local_date
          ))::text as returned
        from (${FIRST_VISITS}) v
        where v.local_date between ${window.from}::date and ${window.to}::date ${filters(window)}`),
    );
    return { cohort: Number(rows[0]?.cohort ?? 0), returned: Number(rows[0]?.returned ?? 0) };
  }

  /** Live visits started before `before` (a local date): left open. */
  async openBefore(before: string, window: Omit<VisitWindow, 'from' | 'to'>): Promise<number> {
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ total: string }>(sql`
        select count(*)::text as total from visits v
        where v.status in ${LIVE} and v.local_date < ${before}::date ${filters(window)}`),
    );
    return Number(rows[0]?.total ?? 0);
  }

  /** Plan items recorded in [from, to) (instants), not removed, by stage and dentist. */
  async planStages(window: { from: Date; to: Date }): Promise<PlanStageRow[]> {
    const { rows } = await this.db.run((tx) =>
      tx.execute<{
        dentist_id: string;
        recorded: string;
        accepted: string;
        started: string;
        completed: string;
      }>(sql`
        select p.dentist_id, count(*)::text as recorded,
          count(*) filter (where p.accepted_at is not null)::text as accepted,
          count(*) filter (where p.started_at is not null)::text as started,
          count(*) filter (where p.status::text = 'performed')::text as completed
        from treatment_plans p
        where p.deleted_at is null
          and p.recorded_at >= ${window.from.toISOString()}::timestamptz
          and p.recorded_at < ${window.to.toISOString()}::timestamptz
        group by p.dentist_id`),
    );
    return rows.map((row) => ({
      dentistId: row.dentist_id,
      recorded: Number(row.recorded),
      accepted: Number(row.accepted),
      started: Number(row.started),
      completed: Number(row.completed),
    }));
  }

  /** Items still `planned` in `currency`: accepted (by priority) and only proposed. */
  async planValue(currency: string): Promise<
    {
      priority: PlanPriority;
      accepted: boolean;
      amount: string;
      items: number;
    }[]
  > {
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ priority: PlanPriority; accepted: boolean; amount: string; items: string }>(sql`
        select p.priority::text as priority, p.accepted_at is not null as accepted,
          sum(p.price_amount)::text as amount, count(*)::text as items
        from treatment_plans p
        where p.deleted_at is null and p.status::text = 'planned' and p.price_currency = ${currency}
        group by 1, 2`),
    );
    return rows.map((row) => ({
      priority: row.priority,
      accepted: row.accepted,
      amount: row.amount,
      items: Number(row.items),
    }));
  }

  /** Patients with an item still planned: accepted, or only proposed (recorded in a window). */
  async planPatientIds(input: {
    accepted: boolean;
    recorded?: { from: Date; to: Date } | undefined;
  }): Promise<string[]> {
    const recorded = input.recorded
      ? sql` and p.recorded_at >= ${input.recorded.from.toISOString()}::timestamptz
          and p.recorded_at < ${input.recorded.to.toISOString()}::timestamptz`
      : sql``;
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ patient_id: string }>(sql`
        select distinct p.patient_id from treatment_plans p
        where p.deleted_at is null and p.status::text = 'planned'
          and p.accepted_at is ${input.accepted ? sql`not null` : sql`null`} ${recorded}`),
    );
    return rows.map((row) => row.patient_id);
  }
}
