import {
  addDays,
  type AppointmentCounts,
  type AppointmentListPage,
  type AppointmentListQuery,
  type DateSpan,
  type OperationalBusyHours,
  type OperationalFollowUps,
  type PatientListQuery,
  type PatientPage,
  weekStartOf,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate, zonedInstant } from '../../../platform/kernel/local-date';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import { ClinicalSummaryService } from '../../clinical';
import { PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { capacityMinutes, openHours } from '../domain/capacity';
import { deriveFollowUp } from '../domain/follow-up-dates';
import { OpeningHoursRepository } from '../persistence/opening-hours.repository';
import {
  type AppointmentDayRow,
  SchedulingSummaryRepository,
} from '../persistence/summary.repository';
import { AppointmentPresenter } from './appointment-presenter';
import { WaitlistOpeningsService } from './waitlist-openings.service';

/** A branch and a dentist the summary keeps to (each optional). */
export interface ScheduleFilter {
  branchId?: string | undefined;
  dentistId?: string | undefined;
}

const ACTIVE = new Set(['booked', 'confirmed', 'checked_in', 'in_room']);
const EMPTY: AppointmentCounts = { due: 0, completed: 0, cancelled: 0, noShow: 0, unresolved: 0 };

/** The counts of rows by status: everything due, then each outcome; still active = unresolved. */
export function countsOf(rows: readonly AppointmentDayRow[]): AppointmentCounts {
  const counts = { ...EMPTY };
  for (const row of rows) {
    counts.due += row.count;
    if (row.status === 'completed') counts.completed += row.count;
    else if (row.status === 'cancelled') counts.cancelled += row.count;
    else if (row.status === 'no_show') counts.noShow += row.count;
    else if (ACTIVE.has(row.status)) counts.unresolved += row.count;
  }
  return counts;
}

const LIST_CURSOR = /^(\d+)_([0-9a-f-]{36})$/;

/**
 * The schedule's figures behind the operational dashboard (feature 19, ADR-0087): appointments
 * due (started, rescheduled ones never — their successor counts), room use against opening hours
 * × active rooms (ADR-0090), busy hours, follow-ups, what needs attention; the Schedule's List
 * view and the patients with an accepted plan and nothing booked. The dashboard reads need
 * `dashboard:operational`, whatever the caller's own scope; the list `appointment:read`.
 */
@Injectable()
export class SchedulingSummaryService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly tenancy: TenancyService,
    private readonly clinical: ClinicalSummaryService,
    private readonly patients: PatientsService,
    private readonly hours: OpeningHoursRepository,
    private readonly summary: SchedulingSummaryRepository,
    private readonly presenter: AppointmentPresenter,
    private readonly openings: WaitlistOpeningsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Due appointments in the period and the one before, by outcome; the 12 weeks by outcome; and
   * room use: booked minutes of due appointments not cancelled ÷ opening minutes × active rooms,
   * over the days of the span that have passed (before today).
   */
  async appointments(
    spans: { current: DateSpan; previous: DateSpan; weeks: readonly string[] },
    filter: ScheduleFilter,
  ) {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(async () => {
      const { timeZone } = await this.tenancy.currentTenant();
      const now = this.clock.now();
      const today = localDate(now, timeZone);
      const rowsOf = (span: DateSpan) =>
        this.summary.startedByDay({ ...this.instants(span, timeZone), ...filter }, now, timeZone);
      const current = await rowsOf(spans.current);
      const previous = await rowsOf(spans.previous);
      const firstWeek = spans.weeks[0] ?? today;
      const lastWeek = spans.weeks.at(-1) ?? firstWeek;
      const weekly = await rowsOf({ from: firstWeek, to: addDays(lastWeek, 6) });
      const capacity = await this.capacityOf(filter.branchId);
      const roomUse = (span: DateSpan, rows: readonly AppointmentDayRow[]) => {
        const end = span.to < today ? span.to : addDays(today, -1);
        const days: string[] = [];
        for (let day = span.from; day <= end; day = addDays(day, 1)) days.push(day);
        const passed = new Set(days);
        return {
          bookedMinutes: rows
            .filter((row) => row.status !== 'cancelled' && passed.has(row.day))
            .reduce((total, row) => total + row.minutes, 0),
          capacityMinutes: capacity(days),
        };
      };
      return {
        counts: { current: countsOf(current), previous: countsOf(previous) },
        weeks: spans.weeks.map((week) => ({
          week,
          ...countsOf(weekly.filter((row) => weekStartOf(row.day) === week)),
        })),
        roomUse: {
          current: roomUse(spans.current, current),
          previous: roomUse(spans.previous, previous),
        },
      };
    });
  }

  /** Per dentist (staff profile id): due appointments, no-shows and booked minutes not cancelled. */
  async byDentist(
    span: DateSpan,
    filter: ScheduleFilter,
  ): Promise<{ dentistId: string; due: number; noShows: number; bookedMinutes: number }[]> {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(async () => {
      const { timeZone } = await this.tenancy.currentTenant();
      const rows = await this.summary.startedByDay(
        { ...this.instants(span, timeZone), ...filter },
        this.clock.now(),
        timeZone,
      );
      const byDentist = new Map<string, { due: number; noShows: number; bookedMinutes: number }>();
      for (const row of rows) {
        const entry = byDentist.get(row.dentistId) ?? { due: 0, noShows: 0, bookedMinutes: 0 };
        entry.due += row.count;
        if (row.status === 'no_show') entry.noShows += row.count;
        if (row.status !== 'cancelled') entry.bookedMinutes += row.minutes;
        byDentist.set(row.dentistId, entry);
      }
      return [...byDentist].map(([dentistId, entry]) => ({ dentistId, ...entry }));
    });
  }

  /** Weekday × hour of the started appointments: booked (not cancelled) and no-shows. */
  async busyHours(span: DateSpan, filter: ScheduleFilter): Promise<OperationalBusyHours> {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(async () => {
      const { timeZone } = await this.tenancy.currentTenant();
      const cells = await this.summary.busyHours(
        { ...this.instants(span, timeZone), ...filter },
        this.clock.now(),
        timeZone,
      );
      const branches = await this.branchIds(filter.branchId);
      const days = (await Promise.all(branches.map((id) => this.hours.forBranch(id)))).flat();
      const hours = new Set(openHours(days));
      for (const cell of cells) hours.add(cell.hour);
      const weekdays = new Set(days.filter((day) => day.isOpen).map((day) => day.weekday));
      for (const cell of cells) weekdays.add(cell.weekday);
      return {
        hours: [...hours].sort((a, b) => a - b),
        // Monday first, as the Schedule's week.
        weekdays: [1, 2, 3, 4, 5, 6, 0].filter((weekday) => weekdays.has(weekday)),
        cells,
      };
    });
  }

  /** Start, end and check-in of the appointments the period's visits came from. */
  appointmentTimes(ids: readonly string[]) {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(() => this.summary.times(ids));
  }

  /** Follow-ups recommended in the span: booked (or done), waiting, declined, expired. */
  async followUps(span: DateSpan, filter: ScheduleFilter): Promise<OperationalFollowUps> {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(async () => {
      const { timeZone } = await this.tenancy.currentTenant();
      const today = localDate(this.clock.now(), timeZone);
      const windowDays = await this.hours.windowDays();
      const rows = await this.summary.followUpsCreated({
        ...this.instants(span, timeZone),
        ...filter,
      });
      const result: OperationalFollowUps = { booked: 0, waiting: 0, declined: 0, expired: 0 };
      for (const row of rows) {
        if (row.status === 'booked' || row.status === 'done') result.booked += 1;
        else if (row.status === 'declined') result.declined += 1;
        else if (deriveFollowUp(row, windowDays, today).expired) result.expired += 1;
        else result.waiting += 1;
      }
      return result;
    });
  }

  /**
   * Needs attention now: unresolved appointments, overdue follow-ups (awaiting, past due, not
   * expired), and — without a branch or dentist — patients with an accepted, unstarted plan item
   * and no upcoming appointment.
   */
  async attention(filter: ScheduleFilter): Promise<{
    unresolved: number;
    followUpsOverdue: number;
    acceptedUnbooked: number | null;
    openingsToFill: number | null;
  }> {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(async () => {
      const { timeZone } = await this.tenancy.currentTenant();
      const now = this.clock.now();
      const today = localDate(now, timeZone);
      const windowDays = await this.hours.windowDays();
      const overdue = (await this.summary.awaitingFollowUps(filter)).filter((row) => {
        const derived = deriveFollowUp(row, windowDays, today);
        return !derived.expired && derived.overdueDays > 0;
      }).length;
      const clinicWide = filter.branchId === undefined && filter.dentistId === undefined;
      return {
        unresolved: await this.summary.unresolvedCount(now, filter),
        followUpsOverdue: overdue,
        acceptedUnbooked: clinicWide ? (await this.acceptedUnbookedIds(now)).length : null,
        // Today's *Openings to fill* (feature 21, C6), for whoever has that lane.
        openingsToFill: await this.openings.openingsToFill(filter),
      };
    });
  }

  /** `GET /scheduling/appointments/list`: the Schedule's List view (feature 19). */
  async list(query: AppointmentListQuery): Promise<AppointmentListPage> {
    this.context.requirePermission('appointment:read');
    if (query.from > query.to) {
      const message = 'The end is before the start';
      throw new ValidationFailedError(message, [{ path: 'to', code: 'invalid', message }]);
    }
    return this.tenantDb.run(async () => {
      const { timeZone } = await this.tenancy.currentTenant();
      const cursor = query.cursor ? LIST_CURSOR.exec(query.cursor) : null;
      const { rows, total } = await this.summary.list(
        {
          ...query,
          ...this.instants(query, timeZone),
          after: cursor
            ? { startsAt: new Date(Number(cursor[1])), id: cursor[2] ?? '' }
            : undefined,
        },
        this.clock.now(),
        timeZone,
      );
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: await this.presenter.presentAll(page),
        nextCursor:
          rows.length > query.limit && last ? `${last.startsAt.getTime()}_${last.id}` : null,
        total,
      };
    });
  }

  /** `GET /scheduling/patients?cohort=accepted_unbooked`: accepted plans with nothing booked. */
  async acceptedUnbooked(query: PatientListQuery): Promise<PatientPage> {
    this.context.requirePermission('patient:read');
    if (query.cohort !== 'accepted_unbooked') {
      const message = 'This cohort is served by another module';
      throw new ValidationFailedError(message, [{ path: 'cohort', code: 'unsupported', message }]);
    }
    return this.tenantDb.run(async () =>
      this.patients.search(
        { ...query, cohort: undefined },
        { idsIn: await this.acceptedUnbookedIds(this.clock.now()) },
      ),
    );
  }

  private async acceptedUnbookedIds(now: Date): Promise<string[]> {
    const accepted = await this.clinical.acceptedPatientIds();
    const booked = await this.summary.withUpcoming(accepted, now);
    return accepted.filter((id) => !booked.has(id));
  }

  /** The chair minutes of `days` in a branch, or in every active branch. */
  private async capacityOf(branchId: string | undefined): Promise<(days: string[]) => number> {
    const branches = await this.branchIds(branchId);
    const parts = await Promise.all(
      branches.map(async (id) => ({
        hours: await this.hours.forBranch(id),
        rooms: (await this.tenancy.roomsOf(id)).filter((room) => room.active).length,
      })),
    );
    return (days) =>
      parts.reduce((total, part) => total + capacityMinutes(part.hours, part.rooms, days), 0);
  }

  private async branchIds(branchId: string | undefined): Promise<string[]> {
    if (branchId !== undefined) return [branchId];
    return (await this.tenancy.allActiveBranches()).map((branch) => branch.id);
  }

  private instants(span: DateSpan, timeZone: string): { from: Date; to: Date } {
    return {
      from: zonedInstant(span.from, '00:00', timeZone),
      to: zonedInstant(addDays(span.to, 1), '00:00', timeZone),
    };
  }
}
