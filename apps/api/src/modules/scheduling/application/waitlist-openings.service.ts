import {
  type Appointment,
  type FillWaitlistEntry,
  type LeaveOpeningResult,
  type WaitlistEntry,
  type WaitlistFit,
  type WaitlistOpening,
  type WaitlistOpeningDetail,
  type WaitlistOpenings,
  type WaitlistPage,
  type WaitlistQuery,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { localClock, localDate } from '../../../platform/kernel/local-date';
import { requestHash } from '../../../platform/kernel/request-hash';
import { AuditService } from '../../audit';
import { PatientsService } from '../../patients';
import { UsersService } from '../../users';
import { AppointmentNotFoundError, WaitlistOpeningTakenError } from '../domain/scheduling-errors';
import { findOpenings, type Opening, openingOf } from '../domain/openings';
import { type FitEntry, startsFor } from '../domain/waitlist-fit';
import { compareFair } from '../domain/waitlist-order';
import {
  AppointmentsRepository,
  type StoredAppointment,
} from '../persistence/appointments.repository';
import { OpeningHoursRepository } from '../persistence/opening-hours.repository';
import { type StoredWaitlistEntry, WaitlistRepository } from '../persistence/waitlist.repository';
import { AppointmentsService } from './appointments.service';
import { type WaitlistNow, WaitlistService } from './waitlist.service';

/** One branch's openings and who fits each, worked out when read (ADR-0104, ADR-0105). */
interface BranchPicture {
  openings: Opening[];
  entries: StoredWaitlistEntry[];
  /** Per opening (by index), the fitting entries in the fair order, with their starts. */
  fits: { entry: StoredWaitlistEntry; starts: Date[] }[][];
  leftOpen: Set<string>;
  dentistNames: Map<string, string>;
}

/**
 * Openings, who fits them, the Waitlist view, *Leave open* and *Fill* (feature 21). Nothing here
 * is stored but what a person does: an opening is the dentist's free time around freed time.
 */
@Injectable()
export class WaitlistOpeningsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly entries: WaitlistService,
    private readonly waitlist: WaitlistRepository,
    private readonly appointmentsService: AppointmentsService,
    private readonly appointments: AppointmentsRepository,
    private readonly hours: OpeningHoursRepository,
    private readonly patients: PatientsService,
    private readonly users: UsersService,
  ) {}

  // --- Reads ---

  /** Schedule › Waitlist (C1): waiting is one page in the fair order; the rest newest first. */
  list(query: WaitlistQuery): Promise<WaitlistPage> {
    this.context.requirePermission('appointment:write_all');
    return this.tenantDb.run(async () => {
      const at = await this.entries.nowOf();
      if (query.status !== 'waiting') {
        const { rows, total } = await this.waitlist.page({
          branchId: query.branchId,
          status: query.status,
          dentistId: query.dentistId,
          appointment: query.appointment,
          beforeId: query.cursor,
          limit: query.limit,
          today: at.today,
          now: at.now,
        });
        const page = rows.slice(0, query.limit);
        return {
          items: await this.entries.present(page, at),
          nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
          total,
        };
      }
      const picture = await this.picture(query.branchId, at);
      const soonest = new Map<string, { openingId: string; startsAt: string; dentistId: string }>();
      picture.openings.forEach((opening, index) => {
        for (const fit of picture.fits[index] ?? []) {
          const [start] = fit.starts;
          if (soonest.has(fit.entry.id) || !start) continue;
          soonest.set(fit.entry.id, {
            openingId: opening.id,
            startsAt: start.toISOString(),
            dentistId: opening.dentistId,
          });
        }
      });
      const rows = picture.entries.filter(
        (row) =>
          (!query.dentistId || row.dentistId === query.dentistId) &&
          (query.appointment === undefined ||
            (query.appointment === 'with') === (row.appointmentId !== null)) &&
          (!query.fits || soonest.has(row.id)),
      );
      const items = (await this.entries.present(this.fair(rows, at), at)).map((entry) => ({
        ...entry,
        fits: soonest.get(entry.id) ?? null,
      }));
      return { items, nextCursor: null, total: items.length };
    });
  }

  /** The branch's openings, soonest first, with how many fit; and how many wait (C1, C3). */
  openings(branchId: string): Promise<WaitlistOpenings> {
    this.context.requirePermission('appointment:write_all');
    return this.tenantDb.run(async () => {
      const at = await this.entries.nowOf();
      const picture = await this.picture(branchId, at);
      return {
        waitingCount: picture.entries.length,
        openings: picture.openings.map((opening, index) =>
          this.presentOpening(branchId, opening, picture, picture.fits[index]?.length ?? 0),
        ),
      };
    });
  }

  /** *Fill* (B4): one opening — a freed appointment's, the one holding `at` — and who fits. */
  opening(appointmentId: string, at?: string): Promise<WaitlistOpeningDetail> {
    this.context.requirePermission('appointment:write_all');
    return this.tenantDb.run(async () => {
      const freed = await this.appointments.byId(appointmentId);
      if (!freed) throw new AppointmentNotFoundError(appointmentId);
      const now = await this.entries.nowOf();
      const picture = await this.picture(freed.branchId, now);
      const opening = openingOf(picture.openings, appointmentId, at ? new Date(at) : undefined);
      if (!opening) return { opening: null, fits: [] };
      const index = picture.openings.indexOf(opening);
      const fits = picture.fits[index] ?? [];
      const presented = new Map(
        (
          await this.entries.present(
            fits.map((fit) => fit.entry),
            now,
          )
        ).map((entry) => [entry.id, entry]),
      );
      return {
        opening: this.presentOpening(freed.branchId, opening, picture, fits.length),
        fits: fits.flatMap((fit): WaitlistFit[] => {
          const entry = presented.get(fit.entry.id);
          return entry ? [{ entry, starts: fit.starts.map((start) => start.toISOString()) }] : [];
        }),
      };
    });
  }

  /**
   * The dashboard's *Openings to fill* (C6): what Today's lane shows — openings someone fits, not
   * left open — in a branch or all of them, of a dentist or all. Null without the lane's right.
   */
  openingsToFill(filter: { branchId?: string | undefined; dentistId?: string | undefined }) {
    if (!this.context.hasPermission('appointment:write_all')) return Promise.resolve(null);
    return this.tenantDb.run(async () => {
      const at = await this.entries.nowOf();
      const branchIds = filter.branchId
        ? [filter.branchId]
        : [
            ...new Set(
              (await this.appointments.freedInBranch(undefined, at.now)).map((row) => row.branchId),
            ),
          ];
      let count = 0;
      for (const branchId of branchIds) {
        const picture = await this.picture(branchId, at);
        picture.openings.forEach((opening, index) => {
          if (filter.dentistId && opening.dentistId !== filter.dentistId) return;
          if ((picture.fits[index]?.length ?? 0) === 0 || this.isLeftOpen(opening, picture)) return;
          count += 1;
        });
      }
      return count;
    });
  }

  // --- Writes ---

  /** *Leave open* (B6): off Today and the dashboard; the calendar still offers *Fill*. */
  leaveOpen(appointmentId: string, at?: string): Promise<LeaveOpeningResult> {
    this.context.requirePermission('appointment:write_all');
    return this.tenantDb.run(async () => {
      const freed = await this.appointments.byId(appointmentId);
      if (!freed) throw new AppointmentNotFoundError(appointmentId);
      const now = await this.entries.nowOf();
      const before = await this.picture(freed.branchId, now);
      const opening = openingOf(before.openings, appointmentId, at ? new Date(at) : undefined);
      if (!opening) return { opening: null };
      await this.waitlist.leaveOpen(opening.freedAppointmentIds, this.context.requireUserId());
      await this.audit.record({
        action: 'waitlist_opening.leave_open',
        resourceType: 'waitlist_opening',
        resourceId: opening.id,
        after: {
          startsAt: opening.start,
          endsAt: opening.end,
          date: opening.date,
          time: localClock(opening.start, now.timeZone),
          endTime: localClock(opening.end, now.timeZone),
          dentistId: opening.dentistId,
          dentistName: before.dentistNames.get(opening.dentistId) ?? '',
        },
      });
      const index = before.openings.indexOf(opening);
      return {
        opening: this.presentOpening(
          freed.branchId,
          opening,
          { ...before, leftOpen: new Set([...before.leftOpen, ...opening.freedAppointmentIds]) },
          before.fits[index]?.length ?? 0,
        ),
      };
    });
  }

  /**
   * *Book* on a row of *Fill* (B4, ADR-0106): one transaction, the dentist locked, the opening
   * worked out again, then the existing move or booking with no override, and the entry booked.
   * The key and the request's hash are stored on the appointment row it creates.
   */
  fill(id: string, input: FillWaitlistEntry, key: string): Promise<Appointment> {
    this.context.requirePermission('appointment:write_all');
    const idempotency = { key, hash: requestHash({ id, ...input }) };
    return this.appointmentsService.runFill(idempotency, async () => {
      const first = await this.waitlist.byId(id);
      const freed = await this.appointments.byId(input.openingId);
      if (!freed) throw new AppointmentNotFoundError(input.openingId);
      // The order of every placing write: patient, appointment, waitlist, dentist (ADR-0106).
      if (first) {
        await this.patients.lockForBooking(first.patientId);
        if (first.appointmentId) await this.appointments.lock(first.appointmentId);
        await this.appointmentsService.lockSchedule(first.patientId, freed.dentistId);
      }
      const at = await this.entries.nowOf();
      const entry = await this.entries.lockLive(id, at);
      const start = new Date(input.startsAt);
      const picture = await this.picture(entry.branchId, at);
      const opening = openingOf(picture.openings, input.openingId, start);
      const index = opening ? picture.openings.indexOf(opening) : -1;
      const fit = (picture.fits[index] ?? []).find((item) => item.entry.id === entry.id);
      if (!opening || !fit?.starts.some((item) => item.getTime() === start.getTime())) {
        throw new WaitlistOpeningTakenError(input.openingId);
      }
      const row = entry.appointmentId
        ? await this.appointmentsService.moveForWaitlist(
            entry.appointmentId,
            {
              startsAt: start,
              dentistId: opening.dentistId,
              roomId: input.roomId,
              confirmed: input.confirmed,
            },
            idempotency,
            entry.id,
          )
        : await this.appointmentsService.bookForWaitlist(
            {
              branchId: entry.branchId,
              patientId: entry.patientId,
              dentistId: opening.dentistId,
              startsAt: start.toISOString(),
              durationMin: entry.durationMin,
              reason: entry.reason,
              visitType: entry.visitType,
              planIds: entry.planIds,
              roomId: 'auto',
              confirmed: input.confirmed,
              override: false,
              ...(await this.liveFollowUp(entry)),
            },
            idempotency,
            entry.id,
          );
      await this.entries.markBooked(entry, row);
      return row;
    });
  }

  // --- The picture ---

  private async picture(branchId: string, at: WaitlistNow): Promise<BranchPicture> {
    const practitioners = await this.users.listPractitioners({ branchId });
    const active = new Set(practitioners.map((item) => item.id));
    const freedRows = (await this.appointments.freedInBranch(branchId, at.now)).filter((row) =>
      active.has(row.dentistId),
    );
    const busyRows = await this.appointments.activeForDentists(
      freedRows.map((row) => row.dentistId),
      at.now,
    );
    const openings = findOpenings({
      freed: freedRows.map((row) => ({
        appointmentId: row.id,
        dentistId: row.dentistId,
        start: row.startsAt,
        end: row.endsAt,
      })),
      busy: busyRows.map((row) => ({
        dentistId: row.dentistId,
        start: row.startsAt,
        end: row.endsAt,
      })),
      hours: await this.hours.forBranch(branchId),
      timeZone: at.timeZone,
      now: at.now,
    });
    const entries = this.fair(await this.waitlist.liveInBranch(branchId, at.today, at.now), at);
    const own = new Map(
      (
        await this.appointments.byIds(
          entries.flatMap((row) => (row.appointmentId ? [row.appointmentId] : [])),
        )
      ).map((row) => [row.id, row]),
    );
    const patientRows = await this.appointments.activeForPatients(
      entries.map((row) => row.patientId),
      at.now,
    );
    const byPatient = new Map<string, StoredAppointment[]>();
    for (const row of patientRows) {
      byPatient.set(row.patientId, [...(byPatient.get(row.patientId) ?? []), row]);
    }
    const fitEntries: [StoredWaitlistEntry, FitEntry][] = entries.map((row) => [
      row,
      this.entries.fitEntryOf(
        row,
        row.appointmentId ? own.get(row.appointmentId) : undefined,
        byPatient.get(row.patientId) ?? [],
      ),
    ]);
    const context = { branchId, timeZone: at.timeZone, today: at.today };
    const fits = openings.map((opening) =>
      fitEntries.flatMap(([row, fitEntry]) => {
        const starts = startsFor(fitEntry, opening, context);
        return starts.length > 0 ? [{ entry: row, starts }] : [];
      }),
    );
    return {
      openings,
      entries,
      fits,
      leftOpen: await this.waitlist.leftOpen(freedRows.map((row) => row.id)),
      dentistNames: new Map(practitioners.map((item) => [item.id, item.displayName])),
    };
  }

  /** B3, with the entry's last attempt read in the clinic's day. */
  private fair(rows: readonly StoredWaitlistEntry[], at: WaitlistNow): StoredWaitlistEntry[] {
    const tried = (row: StoredWaitlistEntry) =>
      row.attemptAt !== null && localDate(row.attemptAt, at.timeZone) === at.today;
    return [...rows].sort((a, b) =>
      compareFair(
        { id: a.id, urgent: a.urgent, triedToday: tried(a), createdAt: a.createdAt },
        { id: b.id, urgent: b.urgent, triedToday: tried(b), createdAt: b.createdAt },
      ),
    );
  }

  private isLeftOpen(opening: Opening, picture: BranchPicture): boolean {
    return opening.freedAppointmentIds.every((id) => picture.leftOpen.has(id));
  }

  private presentOpening(
    branchId: string,
    opening: Opening,
    picture: BranchPicture,
    fitCount: number,
  ): WaitlistOpening {
    return {
      id: opening.id,
      branchId,
      dentistId: opening.dentistId,
      dentistName: picture.dentistNames.get(opening.dentistId) ?? '',
      date: opening.date,
      startsAt: opening.start.toISOString(),
      endsAt: opening.end.toISOString(),
      freed: opening.freed.map((part) => ({
        startsAt: part.start.toISOString(),
        endsAt: part.end.toISOString(),
      })),
      freedAppointmentIds: opening.freedAppointmentIds,
      leftOpen: this.isLeftOpen(opening, picture),
      fitCount,
    };
  }

  /** The entry's follow-up, when it is still awaiting and not expired: the booking takes it. */
  private async liveFollowUp(entry: StoredWaitlistEntry): Promise<{ followUpId?: string }> {
    if (!entry.followUpId) return {};
    const [presented]: WaitlistEntry[] = await this.entries.present(
      [entry],
      await this.entries.nowOf(),
    );
    return presented?.followUpId ? { followUpId: presented.followUpId } : {};
  }
}
