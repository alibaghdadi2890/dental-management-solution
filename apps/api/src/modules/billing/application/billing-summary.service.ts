import {
  addDays,
  type DateSpan,
  type FinancialReceivables,
  fromCents,
  lastDayOfMonth,
  PAYMENT_METHODS,
  type PaymentMethod,
  toCents,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate, zonedInstant } from '../../../platform/kernel/local-date';
import { CatalogService, ClinicalSummaryService } from '../../clinical';
import { PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { agingBucket, agingTotals } from '../domain/aging';
import { splitByService } from '../domain/service-split';
import { AllocationsRepository } from '../persistence/allocations.repository';
import { LedgerEntriesRepository } from '../persistence/ledger-entries.repository';
import { BillingSummaryRepository, type VisitEntryRow } from '../persistence/summary.repository';
import { VisitMoneyFeedRepository } from '../persistence/visit-money-feed.repository';

/** Production of a span (feature 19): see `BillingSummaryService.production`. */
export interface ProductionSummary {
  production: string;
  visitsCharged: number;
  discounts: string;
  gross: string;
}

const sum = (values: Iterable<bigint>) => [...values].reduce((total, value) => total + value, 0n);
const max0 = (value: bigint) => (value > 0n ? value : 0n);

/**
 * The ledger's figures behind the financial dashboard and its drill-downs (feature 19,
 * ADR-0087), each the figure a `billing` screen totals for the same filter. Every method needs
 * `finance:read` (money across patients, ADR-0055). A branch keeps production to the visits of
 * that branch and collections to the payments recorded there. The attribution by dentist is the
 * compensation statement's: production by the visit's dentist, collections by the payment
 * allocations onto the visit's entries, dated by the allocation (ADR-0059).
 */
@Injectable()
export class BillingSummaryService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly tenancy: TenancyService,
    private readonly patients: PatientsService,
    private readonly catalog: CatalogService,
    private readonly clinical: ClinicalSummaryService,
    private readonly summary: BillingSummaryRepository,
    private readonly feed: VisitMoneyFeedRepository,
    private readonly entries: LedgerEntriesRepository,
    private readonly allocations: AllocationsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Σ visit entries (charges, corrections, reversals) dated in the span; the visits charged in it
   * (a charge in the span, never reversed); their discounts (line and visit) and their price
   * before discounts, as the visits stand.
   */
  async production(span: DateSpan, branchId?: string): Promise<ProductionSummary> {
    this.context.requirePermission('finance:read');
    return this.tenantDb.run(async () => {
      const rows = await this.entriesIn(span, branchId);
      const charged = await this.chargedOf(rows);
      const facts = await this.clinical.discountFacts([...charged]);
      return {
        production: fromCents(sum(rows.map((row) => toCents(row.amount)))),
        visitsCharged: charged.size,
        discounts: fromCents(sum(facts.map((fact) => toCents(fact.discount)))),
        gross: fromCents(sum(facts.map((fact) => toCents(fact.gross)))),
      };
    });
  }

  /** Production per month (`YYYY-MM`) over `months`, oldest first. */
  async productionByMonth(
    months: readonly string[],
    branchId?: string,
  ): Promise<{ month: string; amount: string }[]> {
    this.context.requirePermission('finance:read');
    return this.tenantDb.run(async () => {
      const byMonth = new Map<string, bigint>();
      for (const row of await this.entriesIn(monthsSpan(months), branchId)) {
        const month = row.effectiveDate.slice(0, 7);
        byMonth.set(month, (byMonth.get(month) ?? 0n) + toCents(row.amount));
      }
      return months.map((month) => ({ month, amount: fromCents(byMonth.get(month) ?? 0n) }));
    });
  }

  /** Collected in the span (payments not voided − refunds, by paid date) and by method. */
  async collections(
    span: DateSpan,
    branchId?: string,
  ): Promise<{ collected: string; methods: { method: PaymentMethod; amount: string }[] }> {
    this.context.requirePermission('finance:read');
    return this.tenantDb.run(async () => {
      const { currency } = await this.tenancy.currentTenant();
      const rows = await this.summary.paymentTotals({ ...span, branchId }, currency);
      const byMethod = new Map<PaymentMethod, bigint>();
      for (const row of rows) {
        const net = toCents(row.payments) - toCents(row.refunds);
        byMethod.set(row.method, (byMethod.get(row.method) ?? 0n) + net);
      }
      return {
        collected: fromCents(sum(byMethod.values())),
        methods: PAYMENT_METHODS.map((method) => ({
          method,
          amount: fromCents(byMethod.get(method) ?? 0n),
        })),
      };
    });
  }

  async collectionsByMonth(
    months: readonly string[],
    branchId?: string,
  ): Promise<{ month: string; amount: string }[]> {
    this.context.requirePermission('finance:read');
    return this.tenantDb.run(async () => {
      const { currency } = await this.tenancy.currentTenant();
      const byMonth = new Map<string, bigint>();
      for (const row of await this.summary.paymentTotals(
        { ...monthsSpan(months), branchId },
        currency,
      )) {
        const net = toCents(row.payments) - toCents(row.refunds);
        byMonth.set(row.month, (byMonth.get(row.month) ?? 0n) + net);
      }
      return months.map((month) => ({ month, amount: fromCents(byMonth.get(month) ?? 0n) }));
    });
  }

  /** Production and collections per dentist (staff profile id), as the statement attributes them. */
  async byDentist(
    span: DateSpan,
    branchId?: string,
  ): Promise<{ dentistId: string; production: string; collected: string }[]> {
    this.context.requirePermission('finance:read');
    return this.tenantDb.run(async () => {
      const { currency, timeZone } = await this.tenancy.currentTenant();
      const production = new Map<string, bigint>();
      const rows = await this.summary.visitEntries(span, currency);
      const collections = (
        await this.feed.collections({
          from: zonedInstant(span.from, '00:00', timeZone),
          to: zonedInstant(addDays(span.to, 1), '00:00', timeZone),
          createdSince: null,
        })
      ).filter((row) => row.currency === currency);
      const facts = new Map(
        (
          await this.clinical.visitFacts([
            ...rows.map((row) => row.visitId),
            ...collections.map((row) => row.visitId),
          ])
        ).map((fact) => [fact.id, fact]),
      );
      const dentistOf = (visitId: string) => {
        const fact = facts.get(visitId);
        return fact && (branchId === undefined || fact.branchId === branchId)
          ? fact.dentistId
          : undefined;
      };
      for (const row of rows) {
        const dentist = dentistOf(row.visitId);
        if (dentist) production.set(dentist, (production.get(dentist) ?? 0n) + toCents(row.amount));
      }
      const collected = new Map<string, bigint>();
      for (const row of collections) {
        const dentist = dentistOf(row.visitId);
        if (dentist) collected.set(dentist, (collected.get(dentist) ?? 0n) + toCents(row.amount));
      }
      return [...new Set([...production.keys(), ...collected.keys()])].map((dentistId) => ({
        dentistId,
        production: fromCents(production.get(dentistId) ?? 0n),
        collected: fromCents(collected.get(dentistId) ?? 0n),
      }));
    });
  }

  /** Production per service code (`splitByService`), with its current category. */
  async byService(
    span: DateSpan,
    branchId?: string,
  ): Promise<{ code: string; name: string; category: string | null; amount: string }[]> {
    this.context.requirePermission('finance:read');
    return this.tenantDb.run(async () => {
      const rows = await this.entriesIn(span, branchId);
      const histories = await this.summary.linedHistories([
        ...new Set(rows.map((row) => row.visitId)),
      ]);
      const split = splitByService(histories, new Set(rows.map((row) => row.id)));
      const categories = await this.catalog.categoriesByCodes([...split.keys()]);
      return [...split]
        .filter(([, row]) => row.cents !== 0n)
        .map(([code, row]) => ({
          code,
          name: row.name,
          category: categories.get(code) ?? null,
          amount: fromCents(row.cents),
        }));
    });
  }

  /** Receivables now (`GET /billing/aging`'s buckets) and the five largest balances. */
  async receivables(): Promise<FinancialReceivables> {
    this.context.requirePermission('finance:read');
    return this.tenantDb.run(async () => {
      const tenant = await this.tenancy.currentTenant();
      const today = localDate(this.clock.now(), tenant.timeZone);
      const remainders = (await this.allocations.openTargets(tenant.currency)).map((target) => ({
        patientId: target.patientId,
        date: target.date,
        amount: max0(target.net) - target.allocated,
      }));
      const byPatient = new Map<string, { amount: bigint; oldest: string }>();
      for (const remainder of remainders) {
        if (remainder.amount <= 0n) continue;
        const row = byPatient.get(remainder.patientId) ?? { amount: 0n, oldest: remainder.date };
        row.amount += remainder.amount;
        if (remainder.date < row.oldest) row.oldest = remainder.date;
        byPatient.set(remainder.patientId, row);
      }
      const largest = [...byPatient]
        .sort(([idA, a], [idB, b]) =>
          a.amount === b.amount ? (idA < idB ? -1 : 1) : a.amount > b.amount ? -1 : 1,
        )
        .slice(0, 5);
      const refs = new Map(
        (await this.patients.getMany(largest.map(([id]) => id))).map((patient) => [
          patient.id,
          patient,
        ]),
      );
      return {
        currency: tenant.currency,
        total: fromCents(sum(remainders.map((remainder) => remainder.amount))),
        buckets: agingTotals(remainders, today).map((bucket) => ({
          bucket: bucket.bucket,
          amount: fromCents(bucket.amount),
        })),
        largest: largest.map(([patientId, row]) => ({
          patientId,
          fullName: refs.get(patientId)?.fullName ?? '',
          displayNumber: refs.get(patientId)?.displayNumber ?? '',
          amount: fromCents(row.amount),
          oldest: row.oldest,
          bucket: agingBucket(row.oldest, today),
        })),
      };
    });
  }

  /** What patients hold with the clinic now: Σ the accounts in credit (advances held included). */
  async credit(): Promise<string> {
    this.context.requirePermission('finance:read');
    return this.tenantDb.run(async () => {
      const { currency } = await this.tenancy.currentTenant();
      const balances = await this.entries.sumsInCurrency(currency);
      return fromCents(sum(balances.map((row) => max0(-toCents(row.amount)))));
    });
  }

  /**
   * The visits with a visit entry dated in the span (the Visits screen's charged view), and the
   * ones among them charged in it (a charge in the span, never reversed).
   */
  async chargedVisits(span: DateSpan): Promise<{ all: string[]; charged: Set<string> }> {
    return this.tenantDb.run(async () => {
      const rows = await this.entriesIn(span);
      return {
        all: [...new Set(rows.map((row) => row.visitId))],
        charged: await this.chargedOf(rows),
      };
    });
  }

  /** Σ the entries dated in the span of `visitIds`, and the discounts of those charged in it. */
  async chargedTotals(
    span: DateSpan,
    visitIds: readonly string[],
  ): Promise<{ currency: string; charged: string; discounts: string }> {
    return this.tenantDb.run(async () => {
      const { currency } = await this.tenancy.currentTenant();
      const wanted = new Set(visitIds);
      const rows = (await this.entriesIn(span)).filter((row) => wanted.has(row.visitId));
      const charged = await this.chargedOf(rows);
      const facts = await this.clinical.discountFacts([...charged]);
      return {
        currency,
        charged: fromCents(sum(rows.map((row) => toCents(row.amount)))),
        discounts: fromCents(sum(facts.map((fact) => toCents(fact.discount)))),
      };
    });
  }

  /** Each visit's discount (line + visit), for the charged view's `discounted` filter. */
  async discountedAmong(visitIds: readonly string[]): Promise<string[]> {
    const facts = await this.clinical.discountFacts(visitIds);
    return facts.filter((fact) => toCents(fact.discount) > 0n).map((fact) => fact.id);
  }

  /** The tenant-currency visit entries of a span, kept to a branch's visits when asked. */
  private async entriesIn(span: DateSpan, branchId?: string): Promise<VisitEntryRow[]> {
    const { currency } = await this.tenancy.currentTenant();
    const rows = await this.summary.visitEntries(span, currency);
    if (branchId === undefined) return rows;
    const inBranch = new Set(
      (await this.clinical.visitFacts(rows.map((row) => row.visitId)))
        .filter((fact) => fact.branchId === branchId)
        .map((fact) => fact.id),
    );
    return rows.filter((row) => inBranch.has(row.visitId));
  }

  /** The visits charged among `rows`: a `visit_charge` among them, and never reversed. */
  private async chargedOf(rows: readonly VisitEntryRow[]): Promise<Set<string>> {
    const withCharge = [
      ...new Set(rows.filter((row) => row.kind === 'visit_charge').map((row) => row.visitId)),
    ];
    const reversed = await this.summary.reversedVisits(withCharge);
    return new Set(withCharge.filter((visitId) => !reversed.has(visitId)));
  }
}

/** The first day of the first month to the last day of the last. */
function monthsSpan(months: readonly string[]): DateSpan {
  const first = months[0] ?? '1970-01';
  return { from: `${first}-01`, to: lastDayOfMonth(months.at(-1) ?? first) };
}
