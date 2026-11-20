import {
  type DashboardQuery,
  ENTRY_VISIT_TYPES,
  type OperationalAppointments,
  type OperationalAttention,
  type OperationalBusyHours,
  type OperationalDentists,
  type OperationalFollowUps,
  type OperationalLabs,
  type OperationalPatients,
  type OperationalPlans,
  type OperationalVisits,
  type PlanStageCounts,
  VISIT_TYPES,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { localDate } from '../../../platform/kernel/local-date';
import { ClinicalSummaryService, type FinishedVisitRow, type PlanStageRow } from '../../clinical';
import { StockService } from '../../inventory';
import { LabOrderReadsService, LabsService } from '../../labs';
import { PatientsService } from '../../patients';
import { SchedulingSummaryService } from '../../scheduling';
import { TenancyService } from '../../tenancy';
import { UsersService } from '../../users';
import { meanOf, medianOf, waitFigures, waitMinutes } from '../domain/figures';
import { DashboardPeriod } from './dashboard-period';

const EMPTY_STAGES: PlanStageCounts = { recorded: 0, accepted: 0, started: 0, completed: 0 };

function stagesOf(rows: readonly PlanStageRow[], dentistId: string | undefined): PlanStageCounts {
  return rows
    .filter((row) => dentistId === undefined || row.dentistId === dentistId)
    .reduce(
      (total, row) => ({
        recorded: total.recorded + row.recorded,
        accepted: total.accepted + row.accepted,
        started: total.started + row.started,
        completed: total.completed + row.completed,
      }),
      EMPTY_STAGES,
    );
}

/**
 * The Operational tab (feature 19, ADR-0087): counts, rates and times for the whole clinic —
 * `dashboard:operational`, whatever the caller's own visit scope — and never money. Each figure
 * from its owning module's service; a branch and a dentist narrow what has one. Plan figures and
 * registrations belong to no branch: with a branch (or a dentist, for registrations) they step
 * aside.
 */
@Injectable()
export class OperationalDashboardService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly tenancy: TenancyService,
    private readonly users: UsersService,
    private readonly periods: DashboardPeriod,
    private readonly scheduling: SchedulingSummaryService,
    private readonly clinical: ClinicalSummaryService,
    private readonly patients: PatientsService,
    private readonly labOrders: LabOrderReadsService,
    private readonly labs: LabsService,
    private readonly stock: StockService,
  ) {}

  appointments(query: DashboardQuery): Promise<OperationalAppointments> {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(async () => {
      const spans = await this.periods.resolve(query);
      return this.scheduling.appointments(spans, this.filter(query));
    });
  }

  busyHours(query: DashboardQuery): Promise<OperationalBusyHours> {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(async () => {
      const spans = await this.periods.resolve(query);
      return this.scheduling.busyHours(spans.current, this.filter(query));
    });
  }

  /** Finished visits, their months, the wait at check-in, and lengths by visit type. */
  visits(query: DashboardQuery): Promise<OperationalVisits> {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(async () => {
      const spans = await this.periods.resolve(query);
      const filter = this.filter(query);
      const counts = await this.clinical.finishedVisits(spans, filter);
      const current = await this.clinical.finishedVisitRows(spans.current, filter);
      const previous = await this.clinical.finishedVisitRows(spans.previous, filter);
      const times = await this.appointmentTimes([...current, ...previous]);
      return {
        visits: { current: counts.current, previous: counts.previous },
        months: counts.months.map((row) => ({ month: row.month, visits: row.count })),
        wait: {
          current: waitFigures(current.map((visit) => times.wait(visit))),
          previous: waitFigures(previous.map((visit) => times.wait(visit))),
        },
        types: VISIT_TYPES.map((type) => {
          const ofType = current.filter((visit) => visit.type === type);
          return {
            type,
            count: ofType.length,
            bookedMinutes: meanOf(ofType.flatMap((visit) => times.booked(visit) ?? [])),
            takenMinutes: meanOf(ofType.flatMap((visit) => visit.durationMinutes ?? [])),
          };
        }),
      };
    });
  }

  /** New, active and returning patients, _came back_, and what new patients came for. */
  patientsCard(query: DashboardQuery): Promise<OperationalPatients> {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(async () => {
      const spans = await this.periods.resolve(query);
      const summary = await this.clinical.patientsSummary(spans, this.filter(query));
      const types = await this.patients.firstVisitTypes(summary.newCurrent);
      const count = (reason: string | null) =>
        types.filter((row) => row.type === reason).reduce((total, row) => total + row.count, 0);
      return {
        newPatients: { current: summary.newCurrent.length, previous: summary.newPrevious },
        active: summary.active,
        cameBack: summary.cameBack,
        months: summary.months,
        reasons: [
          ...ENTRY_VISIT_TYPES.map((reason) => ({ reason, count: count(reason) })),
          { reason: 'none' as const, count: count(null) },
        ],
      };
    });
  }

  /** Plan items recorded in the period by stage, and the period before (all branches). */
  plans(query: DashboardQuery): Promise<OperationalPlans> {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(async () => {
      const spans = await this.periods.resolve(query);
      return {
        current: stagesOf(await this.clinical.planStages(spans.current), query.dentistId),
        previous: stagesOf(await this.clinical.planStages(spans.previous), query.dentistId),
      };
    });
  }

  /** One row per dentist with something in the period, active dentists of the branch first. */
  dentists(query: DashboardQuery): Promise<OperationalDentists> {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(async () => {
      const spans = await this.periods.resolve(query);
      const filter = this.filter(query);
      const visits = await this.clinical.finishedVisitRows(spans.current, filter);
      const times = await this.appointmentTimes(visits);
      const schedule = new Map(
        (await this.scheduling.byDentist(spans.current, filter)).map((row) => [row.dentistId, row]),
      );
      const plans = await this.clinical.planStages(spans.current);
      const active = await this.users.listPractitioners(
        query.branchId === undefined ? undefined : { branchId: query.branchId },
      );
      const ids = [
        ...new Set([
          ...active.map((dentist) => dentist.id),
          ...visits.map((visit) => visit.dentistId),
          ...schedule.keys(),
        ]),
      ].filter((id) => query.dentistId === undefined || id === query.dentistId);
      const names = new Map(
        (await this.users.practitionersByProfileIds(ids)).map((dentist) => [
          dentist.id,
          dentist.displayName,
        ]),
      );
      return {
        rows: ids.map((profileId) => {
          const own = visits.filter((visit) => visit.dentistId === profileId);
          const booked = schedule.get(profileId);
          const stages = stagesOf(plans, profileId);
          return {
            profileId,
            name: names.get(profileId) ?? '',
            visits: own.length,
            bookedMinutes: booked?.bookedMinutes ?? 0,
            avgVisitMinutes: meanOf(own.flatMap((visit) => visit.durationMinutes ?? [])),
            due: booked?.due ?? 0,
            noShows: booked?.noShows ?? 0,
            plansRecorded: stages.recorded,
            plansAccepted: stages.accepted,
            medianWaitMinutes: medianOf(own.flatMap((visit) => times.wait(visit) ?? [])),
          };
        }),
      };
    });
  }

  /** The lab reports' figures per lab, without costs (`lab:read`), against each lab's promise. */
  labsCard(query: DashboardQuery): Promise<OperationalLabs> {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(async () => {
      const spans = await this.periods.resolve(query);
      const report = await this.labOrders.reports({ ...spans.current, groupBy: 'lab' });
      const promised = new Map(
        (await this.labs.list({ includeInactive: true })).map((lab) => [
          lab.id,
          lab.turnaroundDays,
        ]),
      );
      return {
        rows: report.rows
          .filter((row) => row.figures.sent + row.figures.received > 0)
          .map((row) => ({
            labId: row.key,
            name: row.name,
            received: row.figures.received,
            onTimeRate: row.figures.onTimeRate,
            avgTurnaroundDays: row.figures.avgTurnaroundDays,
            promisedDays: promised.get(row.key) ?? null,
            remakeRate: row.figures.remakeRate,
          })),
      };
    });
  }

  followUps(query: DashboardQuery): Promise<OperationalFollowUps> {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(async () => {
      const spans = await this.periods.resolve(query);
      return this.scheduling.followUps(spans.current, this.filter(query));
    });
  }

  /** Needs attention now; a line the caller may not see, or a filter sets aside, is null. */
  attention(query: DashboardQuery): Promise<OperationalAttention> {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(async () => {
      const filter = this.filter(query);
      const today = (await this.periods.resolve({ period: 'this_month' })).today;
      const schedule = await this.scheduling.attention(filter);
      const lab = this.context.hasPermission('lab:read')
        ? await this.labOrders.attention(filter)
        : null;
      const clinicWide = query.branchId === undefined && query.dentistId === undefined;
      // Stock is per branch, never a dentist's (feature 20a, C4).
      const stock =
        this.context.hasPermission('inventory:read') && query.dentistId === undefined
          ? await this.stock.attention(query.branchId)
          : null;
      return {
        unresolved: schedule.unresolved,
        openVisits: await this.clinical.openVisits(today, filter),
        acceptedUnbooked: schedule.acceptedUnbooked,
        followUpsOverdue: schedule.followUpsOverdue,
        openingsToFill: schedule.openingsToFill,
        labLate: lab?.late ?? null,
        labArrivedUnbooked: lab
          ? { count: lab.arrivedUnbooked.length, orderIds: lab.arrivedUnbooked.slice(0, 50) }
          : null,
        stockOut: stock?.out ?? null,
        stockLow: stock?.low ?? null,
        stockExpired: stock?.expired ?? null,
        incomplete: clinicWide ? await this.patients.incompleteCount() : null,
      };
    });
  }

  private filter(query: DashboardQuery) {
    return { branchId: query.branchId, dentistId: query.dentistId };
  }

  /** The wait and the minutes booked of each visit, from the appointment it came from. */
  private async appointmentTimes(visits: readonly FinishedVisitRow[]) {
    const { timeZone } = await this.tenancy.currentTenant();
    const ids = visits.flatMap((visit) => (visit.appointmentId ? [visit.appointmentId] : []));
    const byId = new Map((await this.scheduling.appointmentTimes(ids)).map((row) => [row.id, row]));
    return {
      wait: (visit: FinishedVisitRow) => {
        const appointment = visit.appointmentId ? byId.get(visit.appointmentId) : undefined;
        if (!appointment) return null;
        return waitMinutes({
          startedAt: visit.startedAt,
          localDate: visit.localDate,
          checkedInAt: appointment.checkedInAt,
          checkedInDate: appointment.checkedInAt
            ? localDate(appointment.checkedInAt, timeZone)
            : null,
        });
      },
      booked: (visit: FinishedVisitRow) => {
        const appointment = visit.appointmentId ? byId.get(visit.appointmentId) : undefined;
        return appointment
          ? Math.round((appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60_000)
          : null;
      },
    };
  }
}
