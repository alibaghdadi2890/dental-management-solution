import type { AppointmentListQuery } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, gte, inArray, lt, ne, type SQL, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { StoredAppointment } from './appointments.repository';
import type { StoredFollowUp } from './follow-ups.repository';
import { appointments, followUps } from './schema';

/** Started appointments of a window by local day, status and dentist (feature 19). */
export interface AppointmentDayRow {
  day: string;
  status: string;
  dentistId: string;
  count: number;
  minutes: number;
}

/** Which appointments a summary counts: instants, branch, dentist. */
export interface AppointmentWindow {
  from: Date;
  to: Date;
  branchId?: string | undefined;
  dentistId?: string | undefined;
}

const ACTIVE = sql.raw(`('booked', 'confirmed', 'checked_in', 'in_room')`);
const UNSETTLED = sql.raw(`('booked', 'confirmed')`);
const iso = (instant: Date) => sql`${instant.toISOString()}::timestamptz`;

function filters(window: { branchId?: string | undefined; dentistId?: string | undefined }): SQL {
  const parts: SQL[] = [];
  if (window.branchId !== undefined) parts.push(sql` and a.branch_id = ${window.branchId}::uuid`);
  if (window.dentistId !== undefined) {
    parts.push(sql` and a.dentist_id = ${window.dentistId}::uuid`);
  }
  return sql.join(parts, sql``);
}

/**
 * Read-only aggregates of `scheduling`'s tables for the dashboards and the Schedule's List view
 * (feature 19, ADR-0087). Rescheduled rows never count: their successor does.
 */
@Injectable()
export class SchedulingSummaryRepository {
  constructor(private readonly db: TenantDb) {}

  /** Appointments starting in [from, to) and before `now`, by local day, status and dentist. */
  async startedByDay(
    window: AppointmentWindow,
    now: Date,
    timeZone: string,
  ): Promise<AppointmentDayRow[]> {
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ day: string; status: string; dentist_id: string; n: string; minutes: string }>(
        sql`
        select to_char((a.starts_at at time zone ${timeZone})::date, 'YYYY-MM-DD') as day,
          a.status::text as status, a.dentist_id, count(*)::text as n,
          coalesce(sum(extract(epoch from (a.ends_at - a.starts_at)) / 60), 0)::bigint::text as minutes
        from appointments a
        where a.starts_at >= ${iso(window.from)} and a.starts_at < ${iso(window.to)}
          and a.starts_at < ${iso(now)} and a.status::text <> 'rescheduled' ${filters(window)}
        group by 1, 2, 3`,
      ),
    );
    return rows.map((row) => ({
      day: row.day,
      status: row.status,
      dentistId: row.dentist_id,
      count: Number(row.n),
      minutes: Number(row.minutes),
    }));
  }

  /** Started appointments by local weekday and hour: not cancelled, and no-shows. */
  async busyHours(
    window: AppointmentWindow,
    now: Date,
    timeZone: string,
  ): Promise<{ weekday: number; hour: number; booked: number; noShows: number }[]> {
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ weekday: number; hour: number; booked: string; no_shows: string }>(sql`
        select extract(dow from a.starts_at at time zone ${timeZone})::int as weekday,
          extract(hour from a.starts_at at time zone ${timeZone})::int as hour,
          count(*) filter (where a.status::text <> 'cancelled')::text as booked,
          count(*) filter (where a.status::text = 'no_show')::text as no_shows
        from appointments a
        where a.starts_at >= ${iso(window.from)} and a.starts_at < ${iso(window.to)}
          and a.starts_at < ${iso(now)} and a.status::text <> 'rescheduled' ${filters(window)}
        group by 1, 2`),
    );
    return rows.map((row) => ({
      weekday: row.weekday,
      hour: row.hour,
      booked: Number(row.booked),
      noShows: Number(row.no_shows),
    }));
  }

  /** Start, end and check-in of each appointment among `ids`. */
  async times(
    ids: readonly string[],
  ): Promise<{ id: string; startsAt: Date; endsAt: Date; checkedInAt: Date | null }[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.run((tx) =>
      tx
        .select({
          id: appointments.id,
          startsAt: appointments.startsAt,
          endsAt: appointments.endsAt,
          checkedInAt: appointments.checkedInAt,
        })
        .from(appointments)
        .where(inArray(appointments.id, [...new Set(ids)])),
    );
    return rows;
  }

  /** Booked or confirmed and already over: unresolved (derived, never stored). */
  async unresolvedCount(now: Date, scope: Omit<AppointmentWindow, 'from' | 'to'>): Promise<number> {
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ total: string }>(sql`
        select count(*)::text as total from appointments a
        where a.status::text in ${UNSETTLED} and a.ends_at <= ${iso(now)} ${filters(scope)}`),
    );
    return Number(rows[0]?.total ?? 0);
  }

  /** Patients among `patientIds` with an active appointment starting from `now`. */
  async withUpcoming(patientIds: readonly string[], now: Date): Promise<Set<string>> {
    if (patientIds.length === 0) return new Set();
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ patient_id: string }>(sql`
        select distinct a.patient_id from appointments a
        where a.status::text in ${ACTIVE} and a.starts_at >= ${iso(now)}
          and a.patient_id = any(${sql.param([...patientIds])}::uuid[])`),
    );
    return new Set(rows.map((row) => row.patient_id));
  }

  /** Follow-ups created in [from, to), of a branch and a recommending dentist when given. */
  async followUpsCreated(window: AppointmentWindow): Promise<StoredFollowUp[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(followUps)
        .where(
          and(
            gte(followUps.createdAt, window.from),
            lt(followUps.createdAt, window.to),
            window.branchId === undefined
              ? undefined
              : sql`${followUps.branchId} = ${window.branchId}::uuid`,
            window.dentistId === undefined
              ? undefined
              : sql`${followUps.recommendedBy} = ${window.dentistId}::uuid`,
          ),
        ),
    );
  }

  /** Awaiting follow-ups, of a branch and a recommending dentist when given. */
  async awaitingFollowUps(
    scope: Omit<AppointmentWindow, 'from' | 'to'>,
  ): Promise<StoredFollowUp[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(followUps)
        .where(
          and(
            sql`${followUps.status} = 'awaiting'`,
            scope.branchId === undefined
              ? undefined
              : sql`${followUps.branchId} = ${scope.branchId}::uuid`,
            scope.dentistId === undefined
              ? undefined
              : sql`${followUps.recommendedBy} = ${scope.dentistId}::uuid`,
          ),
        ),
    );
  }

  /**
   * The Schedule's List view: appointments starting in [from, to), oldest first, after the cursor
   * position, one row past `limit`; and how many match in all.
   */
  async list(
    query: Pick<
      AppointmentListQuery,
      'branchId' | 'dentistId' | 'status' | 'weekday' | 'hour' | 'due'
    > & {
      from: Date;
      to: Date;
      limit: number;
      after?: { startsAt: Date; id: string } | undefined;
    },
    now: Date,
    timeZone: string,
  ): Promise<{ rows: StoredAppointment[]; total: number }> {
    const conditions: (SQL | undefined)[] = [
      gte(appointments.startsAt, query.from),
      lt(appointments.startsAt, query.to),
      ne(appointments.status, 'rescheduled'),
      query.branchId === undefined
        ? undefined
        : sql`${appointments.branchId} = ${query.branchId}::uuid`,
      query.dentistId === undefined
        ? undefined
        : sql`${appointments.dentistId} = ${query.dentistId}::uuid`,
      query.due ? lt(appointments.startsAt, now) : undefined,
      query.weekday === undefined
        ? undefined
        : sql`extract(dow from ${appointments.startsAt} at time zone ${timeZone}) = ${query.weekday}`,
      query.hour === undefined
        ? undefined
        : sql`extract(hour from ${appointments.startsAt} at time zone ${timeZone}) = ${query.hour}`,
    ];
    if (query.status === 'unresolved') {
      conditions.push(
        sql`${appointments.status}::text in ${UNSETTLED}`,
        sql`${appointments.endsAt} <= ${iso(now)}`,
      );
    } else if (query.status !== undefined) {
      conditions.push(sql`${appointments.status}::text = ${query.status}`);
    }
    const where = and(...conditions);
    return this.db.run(async (tx) => {
      const position = query.after
        ? sql`(${appointments.startsAt}, ${appointments.id}) > (${iso(query.after.startsAt)}, ${query.after.id}::uuid)`
        : undefined;
      const rows = await tx
        .select()
        .from(appointments)
        .where(and(where, position))
        .orderBy(asc(appointments.startsAt), asc(appointments.id))
        .limit(query.limit + 1);
      const [counted] = await tx
        .select({ total: sql<string>`count(*)` })
        .from(appointments)
        .where(where);
      return {
        rows: rows.map(({ tenantId: _tenantId, ...row }) => row),
        total: Number(counted?.total ?? 0),
      };
    });
  }
}
