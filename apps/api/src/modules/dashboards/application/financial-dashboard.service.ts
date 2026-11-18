import {
  type DashboardQuery,
  type FinancialCosts,
  type FinancialDentists,
  type FinancialMoney,
  type FinancialOwes,
  type FinancialPlans,
  type FinancialReceivables,
  type FinancialServices,
  fromCents,
  isWholeMonths,
  toCents,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { monthsBetween } from '../../../platform/kernel/months';
import { BillingSummaryService } from '../../billing';
import { ClinicalSummaryService } from '../../clinical';
import { CompensationService } from '../../compensation';
import { ExpensesService } from '../../expenses';
import { LabsService } from '../../labs';
import { PayrollRunsService } from '../../payroll';
import { TenancyService } from '../../tenancy';
import { UsersService } from '../../users';
import { DashboardPeriod } from './dashboard-period';

const sumOf = (values: readonly string[]) =>
  fromCents(values.reduce((total, value) => total + toCents(value), 0n));

/**
 * The Financial tab (feature 19, ADR-0087): one method per card, each `dashboard:financial` and
 * each figure from its owning module's service — the figure that module's screen totals for the
 * same filter. Every part also needs its home permission (expenses `expense:read`, salaries
 * `payroll:read`, dentist pay `compensation:manage`, lab accounts `lab:money_read`), and cost
 * figures need complete cost (ADR-0088). A branch keeps production and collections to it;
 * clinic-wide money ignores it (the SPA shows _All branches only_).
 */
@Injectable()
export class FinancialDashboardService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly tenancy: TenancyService,
    private readonly users: UsersService,
    private readonly periods: DashboardPeriod,
    private readonly billing: BillingSummaryService,
    private readonly clinical: ClinicalSummaryService,
    private readonly expenses: ExpensesService,
    private readonly payroll: PayrollRunsService,
    private readonly compensation: CompensationService,
    private readonly labs: LabsService,
  ) {}

  /** Production, collections, discounts and their 12 months; the payment methods. */
  money(query: DashboardQuery): Promise<FinancialMoney> {
    this.context.requirePermission('dashboard:financial');
    return this.tenantDb.run(async () => {
      const spans = await this.periods.resolve(query);
      const branch = query.branchId;
      const current = await this.billing.production(spans.current, branch);
      const previous = await this.billing.production(spans.previous, branch);
      const collected = await this.billing.collections(spans.current, branch);
      const collectedBefore = await this.billing.collections(spans.previous, branch);
      const production = await this.billing.productionByMonth(spans.months, branch);
      const collections = new Map(
        (await this.billing.collectionsByMonth(spans.months, branch)).map((row) => [
          row.month,
          row.amount,
        ]),
      );
      return {
        currency: (await this.tenancy.currentTenant()).currency,
        production: { current: current.production, previous: previous.production },
        collected: { current: collected.collected, previous: collectedBefore.collected },
        visitsCharged: { current: current.visitsCharged, previous: previous.visitsCharged },
        discounts: { current: current.discounts, previous: previous.discounts },
        gross: { current: current.gross, previous: previous.gross },
        months: production.map((row) => ({
          month: row.month,
          production: row.amount,
          collected: collections.get(row.month) ?? '0.00',
        })),
        methods: collected.methods,
      };
    });
  }

  /** Expenses: by category always; totals, months and cost groups with complete cost only. */
  costs(query: DashboardQuery): Promise<FinancialCosts> {
    this.context.requirePermission('dashboard:financial');
    return this.tenantDb.run(async () => {
      const spans = await this.periods.resolve(query);
      return {
        currency: (await this.tenancy.currentTenant()).currency,
        ...(await this.expenses.dashboardCosts(spans)),
      };
    });
  }

  receivables(): Promise<FinancialReceivables> {
    this.context.requirePermission('dashboard:financial');
    return this.billing.receivables();
  }

  /**
   * Production and collections per dentist (the statement's attribution) and _Unallocated_
   * (collected that no dentist's visit took: credit kept, advances, old balances). With
   * `compensation:manage` and a period of whole months — or months to date — what each earned,
   * from the compensation report (closed months as frozen).
   */
  dentists(query: DashboardQuery): Promise<FinancialDentists> {
    this.context.requirePermission('dashboard:financial');
    return this.tenantDb.run(async () => {
      const spans = await this.periods.resolve(query);
      const rows = await this.billing.byDentist(spans.current, query.branchId);
      const collected = (await this.billing.collections(spans.current, query.branchId)).collected;
      const monthsToDate = spans.current.from.endsWith('-01') && spans.current.to === spans.today;
      const earnedShown =
        this.context.hasPermission('compensation:manage') &&
        query.branchId === undefined &&
        (isWholeMonths(spans.current) || monthsToDate);
      const earned = new Map<string, bigint>();
      if (earnedShown) {
        for (const month of monthsBetween(
          spans.current.from.slice(0, 7),
          spans.current.to.slice(0, 7),
        )) {
          for (const row of (await this.compensation.report(month)).rows) {
            if (row.earned === null) continue;
            earned.set(row.profileId, (earned.get(row.profileId) ?? 0n) + toCents(row.earned));
          }
        }
      }
      const ids = [...new Set([...rows.map((row) => row.dentistId), ...earned.keys()])];
      const names = new Map(
        (await this.users.practitionersByProfileIds(ids)).map((dentist) => [
          dentist.id,
          dentist.displayName,
        ]),
      );
      const byId = new Map(rows.map((row) => [row.dentistId, row]));
      return {
        currency: (await this.tenancy.currentTenant()).currency,
        earnedShown,
        rows: ids
          .map((profileId) => ({
            profileId,
            name: names.get(profileId) ?? '',
            production: byId.get(profileId)?.production ?? '0.00',
            collected: byId.get(profileId)?.collected ?? '0.00',
            earned: earned.has(profileId) ? fromCents(earned.get(profileId) ?? 0n) : null,
          }))
          .sort((a, b) => {
            const diff = toCents(b.production) - toCents(a.production);
            return diff === 0n ? a.name.localeCompare(b.name) : diff > 0n ? 1 : -1;
          }),
        unallocated: fromCents(
          toCents(collected) - toCents(sumOf(rows.map((row) => row.collected))),
        ),
      };
    });
  }

  /** Production by service, largest first, and by category. */
  services(query: DashboardQuery): Promise<FinancialServices> {
    this.context.requirePermission('dashboard:financial');
    return this.tenantDb.run(async () => {
      const spans = await this.periods.resolve(query);
      const services = (await this.billing.byService(spans.current, query.branchId)).sort(
        (a, b) => {
          const diff = toCents(b.amount) - toCents(a.amount);
          return diff === 0n ? a.code.localeCompare(b.code) : diff > 0n ? 1 : -1;
        },
      );
      const byCategory = new Map<string | null, bigint>();
      for (const row of services) {
        byCategory.set(row.category, (byCategory.get(row.category) ?? 0n) + toCents(row.amount));
      }
      return {
        currency: (await this.tenancy.currentTenant()).currency,
        services,
        categories: [...byCategory]
          .sort(([, a], [, b]) => (a === b ? 0 : b > a ? 1 : -1))
          .map(([category, cents]) => ({ category, amount: fromCents(cents) })),
      };
    });
  }

  plans(): Promise<FinancialPlans> {
    this.context.requirePermission('dashboard:financial');
    return this.clinical.planValue();
  }

  /** What the clinic owes now; each line only with its own permission, otherwise null. */
  owes(): Promise<FinancialOwes> {
    this.context.requirePermission('dashboard:financial');
    return this.tenantDb.run(async () => {
      const can = (permission: Parameters<RequestContext['hasPermission']>[0]) =>
        this.context.hasPermission(permission);
      const tenant = await this.tenancy.currentTenant();
      const month = (await this.periods.resolve({ period: 'this_month' })).today.slice(0, 7);
      return {
        currency: tenant.currency,
        labs: can('lab:money_read') ? (await this.labs.accounts()).total.outstanding : null,
        salaries: can('payroll:read') ? await this.payroll.waiting() : null,
        dentists: can('compensation:manage')
          ? (await this.compensation.report(month)).kpis.balanceOwed
          : null,
        fixed: can('expense:read') ? await this.expenses.fixedWaiting() : null,
        credit: await this.billing.credit(),
      };
    });
  }
}
