import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { WaitlistEntryNotFoundError } from '../domain/scheduling-errors';
import { appointments, waitlistEntries, waitlistLeftOpen } from './schema';

type EntryRow = typeof waitlistEntries.$inferSelect;

/** A `waitlist_entries` row as the application sees it (RLS supplies the tenant). */
export type StoredWaitlistEntry = Omit<EntryRow, 'tenantId'>;

export type NewWaitlistEntry = Omit<
  typeof waitlistEntries.$inferInsert,
  'tenantId' | 'createdAt' | 'updatedAt'
>;

export type WaitlistEntryPatch = Partial<
  Omit<EntryRow, 'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'createdBy'>
>;

const waiting = eq(waitlistEntries.status, 'waiting');

/** Waiting and not expired (ADR-0107): its date ahead, or its appointment still waiting ahead. */
const live = (today: string, now: Date) =>
  and(
    waiting,
    or(
      and(isNull(waitlistEntries.appointmentId), sql`${waitlistEntries.untilOn} >= ${today}::date`),
      and(
        isNotNull(waitlistEntries.appointmentId),
        sql`exists (select 1 from ${appointments} where ${appointments.id} = ${waitlistEntries.appointmentId} and ${appointments.status} in ('booked', 'confirmed') and ${appointments.startsAt} > ${now.toISOString()}::timestamptz)`,
      ),
    ),
  );

/** The cursor of the paged statuses: newest first, by uuid v7 id. */
export interface EntryPageFilter {
  branchId: string;
  status: 'booked' | 'removed' | 'expired';
  dentistId?: string | undefined;
  appointment?: 'with' | 'without' | undefined;
  beforeId?: string | undefined;
  limit: number;
  today: string;
  now: Date;
}

@Injectable()
export class WaitlistRepository {
  constructor(private readonly db: TenantDb) {}

  async insert(row: NewWaitlistEntry): Promise<StoredWaitlistEntry> {
    const [created] = await this.db.run((tx) => tx.insert(waitlistEntries).values(row).returning());
    if (!created) throw new Error('waitlist insert returned no row');
    return created;
  }

  async update(id: string, patch: WaitlistEntryPatch): Promise<StoredWaitlistEntry> {
    const [updated] = await this.db.run((tx) =>
      tx.update(waitlistEntries).set(patch).where(eq(waitlistEntries.id, id)).returning(),
    );
    if (!updated) throw new WaitlistEntryNotFoundError(id);
    return updated;
  }

  async lock(id: string): Promise<StoredWaitlistEntry> {
    const [row] = await this.db.run((tx) =>
      tx.select().from(waitlistEntries).where(eq(waitlistEntries.id, id)).for('update'),
    );
    if (!row) throw new WaitlistEntryNotFoundError(id);
    return row;
  }

  async byId(id: string): Promise<StoredWaitlistEntry | undefined> {
    const [row] = await this.db.run((tx) =>
      tx.select().from(waitlistEntries).where(eq(waitlistEntries.id, id)),
    );
    return row;
  }

  /** Adding and the rules run one at a time per patient: one waiting entry of each kind. */
  async lockPatient(patientId: string): Promise<void> {
    await this.db.run((tx) =>
      tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`waitlist:${patientId}`}, 0))`,
      ),
    );
  }

  /** Every waiting row of the patient, expired ones included: the service tells them apart. */
  waitingForPatient(patientId: string): Promise<StoredWaitlistEntry[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(waitlistEntries)
        .where(and(waiting, eq(waitlistEntries.patientId, patientId)))
        .orderBy(asc(waitlistEntries.id)),
    );
  }

  /** The waiting entries of these appointments (the card's mark, the popover's wishes). */
  waitingForAppointments(appointmentIds: readonly string[]): Promise<StoredWaitlistEntry[]> {
    if (appointmentIds.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(waitlistEntries)
        .where(and(waiting, inArray(waitlistEntries.appointmentId, [...new Set(appointmentIds)]))),
    );
  }

  waitingForFollowUps(followUpIds: readonly string[]): Promise<StoredWaitlistEntry[]> {
    if (followUpIds.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(waitlistEntries)
        .where(and(waiting, inArray(waitlistEntries.followUpId, [...new Set(followUpIds)]))),
    );
  }

  waitingFromCancel(appointmentId: string): Promise<StoredWaitlistEntry[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(waitlistEntries)
        .where(and(waiting, eq(waitlistEntries.cancelledAppointmentId, appointmentId))),
    );
  }

  waitingNamingDentist(dentistId: string): Promise<StoredWaitlistEntry[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(waitlistEntries)
        .where(and(waiting, eq(waitlistEntries.dentistId, dentistId))),
    );
  }

  /** The branch's live entries (waiting, not expired): the list, the openings' candidates. */
  liveInBranch(branchId: string, today: string, now: Date): Promise<StoredWaitlistEntry[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(waitlistEntries)
        .where(and(eq(waitlistEntries.branchId, branchId), live(today, now)))
        .orderBy(asc(waitlistEntries.id)),
    );
  }

  /** Every branch's live entries: the dashboard's count across branches. */
  live(today: string, now: Date): Promise<StoredWaitlistEntry[]> {
    return this.db.run((tx) =>
      tx.select().from(waitlistEntries).where(live(today, now)).orderBy(asc(waitlistEntries.id)),
    );
  }

  /** Booked, removed or expired, newest first; one more than `limit` says there is a next page. */
  page(filter: EntryPageFilter): Promise<{ rows: StoredWaitlistEntry[]; total: number }> {
    const statusClause =
      filter.status === 'expired'
        ? and(waiting, sql`not (${live(filter.today, filter.now)})`)
        : eq(waitlistEntries.status, filter.status);
    const where = and(
      eq(waitlistEntries.branchId, filter.branchId),
      statusClause,
      filter.dentistId ? eq(waitlistEntries.dentistId, filter.dentistId) : undefined,
      filter.appointment === 'with'
        ? isNotNull(waitlistEntries.appointmentId)
        : filter.appointment === 'without'
          ? isNull(waitlistEntries.appointmentId)
          : undefined,
    );
    return this.db.run(async (tx) => {
      const rows = await tx
        .select()
        .from(waitlistEntries)
        .where(and(where, filter.beforeId ? lt(waitlistEntries.id, filter.beforeId) : undefined))
        .orderBy(desc(waitlistEntries.id))
        .limit(filter.limit + 1);
      const [count] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(waitlistEntries)
        .where(where);
      return { rows, total: count?.count ?? 0 };
    });
  }

  async repointPatient(droppedId: string, keptId: string): Promise<void> {
    await this.db.run((tx) =>
      tx
        .update(waitlistEntries)
        .set({ patientId: keptId })
        .where(eq(waitlistEntries.patientId, droppedId)),
    );
  }

  async leaveOpen(appointmentIds: readonly string[], userId: string): Promise<void> {
    if (appointmentIds.length === 0) return;
    await this.db.run((tx) =>
      tx
        .insert(waitlistLeftOpen)
        .values(appointmentIds.map((appointmentId) => ({ appointmentId, leftBy: userId })))
        .onConflictDoNothing(),
    );
  }

  async leftOpen(appointmentIds: readonly string[]): Promise<Set<string>> {
    if (appointmentIds.length === 0) return new Set();
    const rows = await this.db.run((tx) =>
      tx
        .select({ id: waitlistLeftOpen.appointmentId })
        .from(waitlistLeftOpen)
        .where(inArray(waitlistLeftOpen.appointmentId, [...new Set(appointmentIds)])),
    );
    return new Set(rows.map((row) => row.id));
  }
}
