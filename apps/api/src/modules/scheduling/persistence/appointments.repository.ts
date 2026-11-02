import { ACTIVE_APPOINTMENT_STATUSES } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { Interval } from '../domain/intervals';
import { AppointmentNotFoundError } from '../domain/scheduling-errors';
import { appointments } from './schema';

type AppointmentRow = typeof appointments.$inferSelect;

/** An `appointments` row as the application sees it (RLS supplies the tenant). */
export type StoredAppointment = Omit<AppointmentRow, 'tenantId'>;

export type NewAppointment = Omit<
  typeof appointments.$inferInsert,
  'tenantId' | 'createdAt' | 'updatedAt'
>;

export type AppointmentPatch = Partial<
  Pick<
    AppointmentRow,
    | 'status'
    | 'roomId'
    | 'roomAuto'
    | 'endsAt'
    | 'patientId'
    | 'followUpId'
    | 'overridden'
    | 'confirmedBy'
    | 'confirmedAt'
    | 'checkedInBy'
    | 'checkedInAt'
    | 'closedBy'
    | 'closedAt'
    | 'cancelReason'
  >
>;

export interface AppointmentRangeFilter {
  branchId: string;
  from: Date;
  to: Date;
  dentistIds?: readonly string[] | undefined;
  roomId?: string | undefined;
}

export interface LineageRow {
  id: string;
  lineageId: string;
  status: AppointmentRow['status'];
  startsAt: Date;
  createdAt: Date;
}

const active = inArray(appointments.status, [...ACTIVE_APPOINTMENT_STATUSES]);

@Injectable()
export class AppointmentsRepository {
  constructor(private readonly db: TenantDb) {}

  async insert(row: NewAppointment): Promise<StoredAppointment> {
    const [created] = await this.db.run((tx) => tx.insert(appointments).values(row).returning());
    if (!created) throw new Error('appointment insert returned no row');
    return created;
  }

  async update(id: string, patch: AppointmentPatch): Promise<StoredAppointment> {
    const [updated] = await this.db.run((tx) =>
      tx.update(appointments).set(patch).where(eq(appointments.id, id)).returning(),
    );
    if (!updated) throw new AppointmentNotFoundError(id);
    return updated;
  }

  async byId(id: string): Promise<StoredAppointment | undefined> {
    const [row] = await this.db.run((tx) =>
      tx.select().from(appointments).where(eq(appointments.id, id)),
    );
    return row;
  }

  async lock(id: string): Promise<StoredAppointment> {
    const [row] = await this.db.run((tx) =>
      tx.select().from(appointments).where(eq(appointments.id, id)).for('update'),
    );
    if (!row) throw new AppointmentNotFoundError(id);
    return row;
  }

  /** What the calendar draws: a rescheduled row is not drawn, its successor is. */
  range(filter: AppointmentRangeFilter): Promise<StoredAppointment[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.branchId, filter.branchId),
            lt(appointments.startsAt, filter.to),
            gte(appointments.endsAt, filter.from),
            ne(appointments.status, 'rescheduled'),
            filter.dentistIds ? inArray(appointments.dentistId, [...filter.dentistIds]) : undefined,
            filter.roomId ? eq(appointments.roomId, filter.roomId) : undefined,
          ),
        )
        .orderBy(asc(appointments.startsAt), asc(appointments.id)),
    );
  }

  /** Every active appointment of the clinic touching `span`: a dentist may work in two branches. */
  activeOverlapping(span: Interval): Promise<StoredAppointment[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(appointments)
        .where(
          and(active, lt(appointments.startsAt, span.end), gte(appointments.endsAt, span.start)),
        )
        .orderBy(asc(appointments.startsAt)),
    );
  }

  forPatient(patientId: string): Promise<StoredAppointment[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(appointments)
        .where(eq(appointments.patientId, patientId))
        .orderBy(desc(appointments.startsAt), desc(appointments.id)),
    );
  }

  activeForPatient(patientId: string): Promise<StoredAppointment[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(appointments)
        .where(and(active, eq(appointments.patientId, patientId)))
        .orderBy(asc(appointments.startsAt)),
    );
  }

  activeInLineage(lineageId: string): Promise<StoredAppointment[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(appointments)
        .where(and(active, eq(appointments.lineageId, lineageId))),
    );
  }

  async countUpcomingForPatient(patientId: string, now: Date): Promise<number> {
    const [row] = await this.db.run((tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(appointments)
        .where(and(active, eq(appointments.patientId, patientId), gte(appointments.startsAt, now))),
    );
    return row?.count ?? 0;
  }

  /** Past or future: an unresolved appointment needs its dentist's column too (G16). */
  async countOpenForDentist(dentistId: string): Promise<number> {
    const [row] = await this.db.run((tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(appointments)
        .where(and(active, eq(appointments.dentistId, dentistId))),
    );
    return row?.count ?? 0;
  }

  async repointPatient(droppedId: string, keptId: string): Promise<void> {
    await this.db.run((tx) =>
      tx
        .update(appointments)
        .set({ patientId: keptId })
        .where(eq(appointments.patientId, droppedId)),
    );
  }

  /** Oldest first, by id: uuid v7 is the application's clock, and a move always follows its row. */
  lineages(lineageIds: readonly string[]): Promise<LineageRow[]> {
    if (lineageIds.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select({
          id: appointments.id,
          lineageId: appointments.lineageId,
          status: appointments.status,
          startsAt: appointments.startsAt,
          createdAt: appointments.createdAt,
        })
        .from(appointments)
        .where(inArray(appointments.lineageId, [...new Set(lineageIds)]))
        .orderBy(asc(appointments.id)),
    );
  }

  /** The row that holds each follow-up now: its active or completed appointment. */
  async holdersOf(followUpIds: readonly string[]): Promise<Map<string, string>> {
    if (followUpIds.length === 0) return new Map();
    const rows = await this.db.run((tx) =>
      tx
        .select({ id: appointments.id, followUpId: appointments.followUpId })
        .from(appointments)
        .where(
          and(
            inArray(appointments.followUpId, [...followUpIds]),
            inArray(appointments.status, [...ACTIVE_APPOINTMENT_STATUSES, 'completed']),
          ),
        ),
    );
    return new Map(rows.flatMap((row) => (row.followUpId ? [[row.followUpId, row.id]] : [])));
  }

  /** Requests sharing an `Idempotency-Key` run one at a time, to the end of the transaction. */
  async lockIdempotencyKey(key: string): Promise<void> {
    await this.db.run((tx) =>
      tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`appointment-key:${key}`}, 0))`,
      ),
    );
  }

  async byIdempotencyKey(key: string): Promise<StoredAppointment | undefined> {
    const [row] = await this.db.run((tx) =>
      tx.select().from(appointments).where(eq(appointments.idempotencyKey, key)).limit(1),
    );
    return row;
  }
}
