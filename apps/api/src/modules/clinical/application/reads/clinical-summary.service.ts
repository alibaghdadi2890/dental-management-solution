import {
  addDays,
  addMonths,
  type DateSpan,
  lastDayOfMonth,
  PLAN_PRIORITIES,
  type PatientListQuery,
  type PatientPage,
  type PlanPriority,
  fromCents,
  toCents,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../../platform/clock/clock.module';
import { RequestContext } from '../../../../platform/cls/request-context';
import { TenantDb } from '../../../../platform/db/tenant-db';
import type { Clock } from '../../../../platform/kernel/clock';
import { localDate, zonedInstant } from '../../../../platform/kernel/local-date';
import { ValidationFailedError } from '../../../../platform/kernel/validation-failed.error';
import { PatientsService } from '../../../patients';
import { TenancyService } from '../../../tenancy';
import {
  ClinicalSummaryRepository,
  type FinishedVisitRow,
  type PlanStageRow,
  type VisitWindow,
} from '../../persistence/summary.repository';

/** A branch and a dentist the summary keeps to (each optional). */
export interface SummaryFilter {
  branchId?: string | undefined;
  dentistId?: string | undefined;
}

/** What the operational dashboard's Patients card counts (feature 19). */
export interface PatientsSummary {
  newCurrent: string[];
  newPrevious: number;
  active: number;
  cameBack: { cohort: number; returned: number };
  months: { month: string; new: number; returning: number }[];
}

/**
 * The visit and plan facts behind the dashboards (feature 19, ADR-0087): counts and timings for
 * the operational tab (`dashboard:operational`, whatever the caller's visit scope), the plan
 * value for the financial one (`finance:read`), the cohorts the Patients screen lists, and two
 * ungated building blocks `billing` reads under its own checks (`visitFacts`, `discountFacts`).
 */
@Injectable()
export class ClinicalSummaryService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly tenancy: TenancyService,
    private readonly patients: PatientsService,
    private readonly summary: ClinicalSummaryRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** For `billing`'s production by branch and dentist: each visit's branch, dentist, status. */
  visitFacts(visitIds: readonly string[]) {
    return this.tenantDb.run(() => this.summary.visitFacts([...new Set(visitIds)]));
  }

  /** For `billing`'s Discounts: each visit's price before discounts and its discounts. */
  discountFacts(visitIds: readonly string[]) {
    return this.tenantDb.run(() => this.summary.discountFacts([...new Set(visitIds)]));
  }

  /** Finished visits in a span, and per month over `months` (`YYYY-MM`, oldest first). */
  async finishedVisits(
    spans: { current: DateSpan; previous: DateSpan; months: readonly string[] },
    filter: SummaryFilter,
  ): Promise<{ current: number; previous: number; months: { month: string; count: number }[] }> {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(async () => {
      const byMonth = new Map(
        (await this.summary.finishedByMonth({ ...this.monthsSpan(spans.months), ...filter })).map(
          (row) => [row.month, row.count],
        ),
      );
      return {
        current: await this.summary.finishedCount({ ...spans.current, ...filter }),
        previous: await this.summary.finishedCount({ ...spans.previous, ...filter }),
        months: spans.months.map((month) => ({ month, count: byMonth.get(month) ?? 0 })),
      };
    });
  }

  /** Each finished, non-imported visit of the span, for waits and visit lengths. */
  finishedVisitRows(span: DateSpan, filter: SummaryFilter): Promise<FinishedVisitRow[]> {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(() => this.summary.finishedVisits({ ...span, ...filter }));
  }

  /**
   * New patients (first visit ever in the span, imported visits included), active ones (a visit
   * in the 12 months to `today`), _came back_ (of those first seen 3–6 months ago, who had a
   * later visit) and, per month, new and returning patients (non-imported visits).
   */
  async patientsSummary(
    spans: { current: DateSpan; previous: DateSpan; months: readonly string[]; today: string },
    filter: SummaryFilter,
  ): Promise<PatientsSummary> {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(async () => {
      const monthsSpan = this.monthsSpan(spans.months);
      const firsts = await this.summary.firstSeen({ ...monthsSpan, ...filter });
      const newByMonth = new Map<string, Set<string>>();
      for (const row of firsts) {
        const month = row.date.slice(0, 7);
        newByMonth.set(month, (newByMonth.get(month) ?? new Set()).add(row.patientId));
      }
      const seenByMonth = new Map<string, Set<string>>();
      for (const row of await this.summary.seenByMonth({ ...monthsSpan, ...filter }, false)) {
        seenByMonth.set(row.month, (seenByMonth.get(row.month) ?? new Set()).add(row.patientId));
      }
      const today = spans.today;
      const cohort = {
        from: addDays(this.monthsBefore(today, 6), 1),
        to: this.monthsBefore(today, 3),
      };
      return {
        newCurrent: (await this.summary.firstSeen({ ...spans.current, ...filter })).map(
          (row) => row.patientId,
        ),
        newPrevious: (await this.summary.firstSeen({ ...spans.previous, ...filter })).length,
        active: (await this.activeIds(today, filter)).length,
        cameBack: await this.summary.cameBack({ ...cohort, ...filter }),
        months: spans.months.map((month) => {
          const fresh = newByMonth.get(month) ?? new Set<string>();
          const seen = seenByMonth.get(month) ?? new Set<string>();
          const returning = [...seen].filter((id) => !fresh.has(id)).length;
          return { month, new: fresh.size, returning };
        }),
      };
    });
  }

  /** Plan items recorded in a span, by stage and dentist (instants in the clinic time zone). */
  async planStages(span: DateSpan): Promise<PlanStageRow[]> {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(async () => this.summary.planStages(await this.instants(span)));
  }

  /** Accepted, not started items by priority (`PLAN_PRIORITIES` order) and proposed ones. */
  async planValue(): Promise<{
    currency: string;
    accepted: { priority: PlanPriority; amount: string; items: number }[];
    proposed: { amount: string; items: number };
  }> {
    this.context.requirePermission('finance:read');
    return this.tenantDb.run(async () => {
      const { currency } = await this.tenancy.currentTenant();
      const rows = await this.summary.planValue(currency);
      const sum = (selected: typeof rows) => ({
        amount: fromCents(selected.reduce((total, row) => total + toCents(row.amount), 0n)),
        items: selected.reduce((total, row) => total + row.items, 0),
      });
      return {
        currency,
        accepted: PLAN_PRIORITIES.map((priority) => ({
          priority,
          ...sum(rows.filter((row) => row.accepted && row.priority === priority)),
        })),
        proposed: sum(rows.filter((row) => !row.accepted)),
      };
    });
  }

  /** Live visits started before today: left open. */
  async openVisits(today: string, filter: SummaryFilter): Promise<number> {
    this.context.requirePermission('dashboard:operational');
    return this.tenantDb.run(() => this.summary.openBefore(today, filter));
  }

  /** For `scheduling` (accepted with nothing booked): patients with an accepted, unstarted item. */
  acceptedPatientIds(): Promise<string[]> {
    return this.tenantDb.run(() => this.summary.planPatientIds({ accepted: true }));
  }

  /**
   * `GET /clinical/patients?cohort=`: the Patients screen restricted to a dashboard figure's
   * patients — first seen in `from`–`to`, seen in the last 12 months, with a proposed item
   * (recorded in the range, when given) or an accepted one not started.
   */
  async cohort(query: PatientListQuery): Promise<PatientPage> {
    this.context.requirePermission('patient:read');
    if (query.view === 'owing' || query.view === 'notSeen' || query.sort === 'balance') {
      throw unsupported('view', 'This view is served by billing or the not-seen route');
    }
    const filter = { branchId: query.cohortBranch, dentistId: query.cohortDentist };
    return this.tenantDb.run(async () => {
      const today = await this.today();
      let ids: string[];
      switch (query.cohort) {
        case 'first_seen':
          if (!query.from || !query.to) throw unsupported('from', 'A range is needed');
          ids = (await this.summary.firstSeen({ from: query.from, to: query.to, ...filter })).map(
            (row) => row.patientId,
          );
          break;
        case 'seen':
          ids = await this.activeIds(today, filter);
          break;
        case 'proposed':
          ids = await this.summary.planPatientIds({
            accepted: false,
            recorded:
              query.from && query.to
                ? await this.instants({ from: query.from, to: query.to })
                : undefined,
          });
          break;
        case 'accepted':
          ids = await this.summary.planPatientIds({ accepted: true });
          break;
        default:
          throw unsupported('cohort', 'This cohort is served by another module');
      }
      return this.patients.search({ ...query, cohort: undefined }, { idsIn: ids });
    });
  }

  private activeIds(today: string, filter: SummaryFilter): Promise<string[]> {
    return this.summary.seenIds({
      from: addDays(this.monthsBefore(today, 12), 1),
      to: today,
      ...filter,
    });
  }

  /** The same day `count` months before `date`, clamped to that month's end. */
  private monthsBefore(date: string, count: number): string {
    const month = addMonths(date.slice(0, 7), -count);
    const candidate = `${month}-${date.slice(8, 10)}`;
    const end = lastDayOfMonth(month);
    return candidate > end ? end : candidate;
  }

  private monthsSpan(months: readonly string[]): VisitWindow {
    const first = months[0] ?? '1970-01';
    const last = months.at(-1) ?? first;
    return { from: `${first}-01`, to: lastDayOfMonth(last) };
  }

  private async instants(span: DateSpan): Promise<{ from: Date; to: Date }> {
    const { timeZone } = await this.tenancy.currentTenant();
    return {
      from: zonedInstant(span.from, '00:00', timeZone),
      to: zonedInstant(addDays(span.to, 1), '00:00', timeZone),
    };
  }

  private async today(): Promise<string> {
    return localDate(this.clock.now(), (await this.tenancy.currentTenant()).timeZone);
  }
}

function unsupported(path: string, message: string): ValidationFailedError {
  return new ValidationFailedError(message, [{ path, code: 'unsupported', message }]);
}
