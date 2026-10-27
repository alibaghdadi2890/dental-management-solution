import { toCents } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { localDate, zonedInstant } from '../../../platform/kernel/local-date';
import { BillingService } from '../../billing';
import { CatalogService, VisitFactsService } from '../../clinical';
import { TenancyService } from '../../tenancy';
import { isLive } from '../domain/agreements';
import type { ChargeLinesFact } from '../domain/blend';
import {
  type CollectionFact,
  computeMonths,
  type DentistData,
  type EntryFact,
  generationIds,
  type LateContext,
  type VisitFact,
} from '../domain/compute';
import { firstDay, lastDay, monthOf, nextMonth } from '../domain/months';
import { firstMonthOf } from '../domain/periods';
import { type PeriodSnapshot, snapshotOf } from '../domain/snapshot';
import { AgreementsRepository, type StoredAgreement } from '../persistence/agreements.repository';
import {
  AdjustmentsRepository,
  PayoutsRepository,
  type StoredAdjustment,
  type StoredPayout,
} from '../persistence/money-rows.repository';
import { PeriodsRepository, type StoredPeriod } from '../persistence/periods.repository';

/** A late line of a closed month may have been written just before the close committed: look
 * back this far before the last close for lines no snapshot counted (ADR-0059). */
const LATE_LOOKBACK_MS = 86_400_000;

/** One dentist's month, as computed (open) or frozen (closed). */
export interface DentistMonth {
  profileId: string;
  month: string;
  status: 'provisional' | 'closed';
  closedAt: Date | null;
  firstMonth: string | null;
  lastClosed: string | null;
  agreements: StoredAgreement[];
  view: PeriodSnapshot;
  /** Every line id of the month: what closing it remembers. */
  lineIds: string[];
  adjustments: StoredAdjustment[];
  payouts: StoredPayout[];
}

interface Plan {
  profileId: string;
  agreements: StoredAgreement[];
  firstMonth: string | null;
  lastClosed: StoredPeriod | undefined;
  closedView?: StoredPeriod;
  from: string;
  opening: bigint;
  createdSince: Date | null;
}

const byProfile = <T extends { profileId: string }>(rows: readonly T[], profileId: string) =>
  rows.filter((row) => row.profileId === profileId);

/**
 * Gathers what the statements of a month need and runs the pure computation (ADR-0059) for one
 * dentist or all of them at once (the report). A closed month is its snapshot; an open month is
 * computed forward from the last closed one (or the dentist's first month), late entries going to
 * the first open month. Callers run it inside their `TenantDb` transaction and check permissions:
 * it reads `billing`'s and `clinical`'s building blocks, which check none.
 */
@Injectable()
export class StatementReader {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly billing: BillingService,
    private readonly visitFacts: VisitFactsService,
    private readonly catalog: CatalogService,
    private readonly agreements: AgreementsRepository,
    private readonly adjustments: AdjustmentsRepository,
    private readonly payouts: PayoutsRepository,
    private readonly periods: PeriodsRepository,
  ) {}

  async months(profileIds: readonly string[], month: string): Promise<Map<string, DentistMonth>> {
    const { currency, timeZone } = await this.tenancy.currentTenant();
    // Sequential: every read joins the caller's transaction, i.e. one connection.
    const agreements = await this.agreements.list(profileIds);
    const lastClosed = await this.periods.lastClosed(profileIds);
    const firstAdjustments = await this.adjustments.firstDates(profileIds);
    const firstPayouts = await this.payouts.firstDates(profileIds);

    const plans: Plan[] = [];
    for (const profileId of profileIds) {
      const own = byProfile(agreements, profileId);
      const firstMonth = firstMonthOf([
        ...own.filter(isLive).map((agreement) => agreement.effectiveFrom),
        ...[firstAdjustments.get(profileId), firstPayouts.get(profileId)].filter(
          (date): date is string => date !== undefined,
        ),
      ]);
      const closed = lastClosed.get(profileId);
      const plan: Plan = {
        profileId,
        agreements: own,
        firstMonth,
        lastClosed: closed,
        from: month,
        opening: 0n,
        createdSince: null,
      };
      if (closed && month <= closed.month) {
        const frozen = month === closed.month ? closed : await this.periods.find(profileId, month);
        if (frozen?.status === 'closed') plan.closedView = frozen;
      } else if (closed) {
        plan.from = nextMonth(closed.month);
        plan.opening = toCents(closed.snapshot.totals.closing);
        plan.createdSince = new Date(closed.closedAt.getTime() - LATE_LOOKBACK_MS);
      } else if (firstMonth !== null && firstMonth <= month) {
        plan.from = firstMonth;
      }
      plans.push(plan);
    }

    const open = plans.filter((plan) => plan.closedView === undefined);
    const computed = await this.compute(open, month, currency, timeZone);
    const money = await this.moneyRows(profileIds, month);

    const result = new Map<string, DentistMonth>();
    for (const plan of plans) {
      const base = {
        profileId: plan.profileId,
        month,
        firstMonth: plan.firstMonth,
        lastClosed: plan.lastClosed?.month ?? null,
        agreements: plan.agreements,
        adjustments: byProfile(money.adjustments, plan.profileId),
        payouts: byProfile(money.payouts, plan.profileId),
      };
      if (plan.closedView) {
        result.set(plan.profileId, {
          ...base,
          status: 'closed',
          closedAt: plan.closedView.closedAt,
          view: plan.closedView.snapshot,
          lineIds: [],
        });
        continue;
      }
      const monthResult = computed.get(plan.profileId);
      if (!monthResult) throw new Error(`No computation for ${plan.profileId}`);
      result.set(plan.profileId, {
        ...base,
        status: 'provisional',
        closedAt: null,
        view: snapshotOf(monthResult),
        lineIds: monthResult.lineIds,
      });
    }
    return result;
  }

  private async moneyRows(profileIds: readonly string[], month: string) {
    const range = { from: firstDay(month), to: lastDay(month) };
    return {
      adjustments: await this.adjustments.list(range, profileIds),
      payouts: await this.payouts.list(range, profileIds),
    };
  }

  private async compute(plans: readonly Plan[], month: string, currency: string, timeZone: string) {
    const results = new Map<string, ReturnType<typeof computeMonths>[number]>();
    if (plans.length === 0) return results;
    const from = plans.reduce(
      (earliest, plan) => (plan.from < earliest ? plan.from : earliest),
      month,
    );
    const createdSince = plans.reduce<Date | null>(
      (earliest, plan) =>
        plan.createdSince !== null && (earliest === null || plan.createdSince < earliest)
          ? plan.createdSince
          : earliest,
      null,
    );
    const dates = { from: firstDay(from), to: lastDay(month) };

    const entries = await this.billing.visitChargesBetween({ ...dates, createdSince });
    const collections = await this.billing.visitCollectionsBetween({
      from: zonedInstant(firstDay(from), '00:00', timeZone),
      to: zonedInstant(firstDay(nextMonth(month)), '00:00', timeZone),
      createdSince,
    });
    const facts = await this.visitFacts.compensationFacts({
      ...dates,
      changedSince: createdSince,
      visitIds: [...new Set([...entries, ...collections].map((row) => row.visitId))],
      dentistIds: plans.map((plan) => plan.profileId),
    });
    const visits = new Map(facts.map((fact) => [fact.visitId, fact]));
    const ours = (row: { visitId: string }) => visits.has(row.visitId);
    const entryFacts: EntryFact[] = entries.filter(ours).map((entry) => ({
      id: entry.id,
      visitId: entry.visitId,
      kind: entry.kind,
      amount: entry.amount,
      currency: entry.currency,
      date: entry.effectiveDate,
    }));
    const collectionFacts: CollectionFact[] = collections.filter(ours).map((row) => ({
      id: row.id,
      visitId: row.visitId,
      kind: row.kind,
      amount: row.amount,
      currency: row.currency,
      date: localDate(row.createdAt, timeZone),
    }));

    const overrides = plans.some((plan) =>
      plan.agreements.some((agreement) =>
        agreement.components.some(
          (component) => component.kind === 'share' && component.rateOverrides.length > 0,
        ),
      ),
    );
    const charged = [...new Set([...entryFacts, ...collectionFacts].map((row) => row.visitId))];
    const chargeLines: ChargeLinesFact[] = overrides
      ? await this.billing.chargeLinesFor(charged)
      : [];
    const byCategory = plans.some((plan) =>
      plan.agreements.some((agreement) =>
        agreement.components.some(
          (component) =>
            component.kind === 'share' &&
            component.rateOverrides.some((override) => override.target === 'category'),
        ),
      ),
    );
    const categories = byCategory
      ? await this.catalog.categoriesByCodes([
          ...new Set(chargeLines.flatMap((charge) => charge.lines.map((line) => line.code))),
        ])
      : new Map<string, string | null>();
    const chargeLinesByVisit = new Map(chargeLines.map((charge) => [charge.visitId, charge]));
    const range = { from: firstDay(from), to: lastDay(month) };
    const adjustments = await this.adjustments.list(
      range,
      plans.map((plan) => plan.profileId),
    );
    const payouts = await this.payouts.list(
      range,
      plans.map((plan) => plan.profileId),
    );

    for (const plan of plans) {
      const dentistVisits = new Map<string, VisitFact>(
        facts
          .filter((fact) => fact.dentistId === plan.profileId)
          .map((fact) => [fact.visitId, fact]),
      );
      const mine = (row: { visitId: string }) => dentistVisits.has(row.visitId);
      const dentistEntries = entryFacts.filter(mine);
      const dentistCollections = collectionFacts.filter(mine);
      let late: LateContext | null = null;
      // Only an open month after the last closed one reports late entries (a month before the
      // dentist's first, with no snapshot, has none).
      if (plan.lastClosed && plan.createdSince !== null) {
        const lastClosed = plan.lastClosed.month;
        const closedDate = (date: string) => monthOf(date) <= lastClosed;
        const candidates = [
          ...[...dentistEntries, ...dentistCollections]
            .filter((row) => closedDate(row.date))
            .map((row) => row.id),
          ...[...dentistVisits.values()]
            .filter((visit) => closedDate(visit.localDate))
            .flatMap((visit) => [
              ...generationIds(`visit:${visit.visitId}`),
              ...generationIds(`day:${visit.localDate}`),
            ]),
        ];
        late = {
          lastClosed,
          included: await this.periods.includedAmong(plan.profileId, [...new Set(candidates)]),
        };
      }
      const data: DentistData = {
        currency,
        agreements: plan.agreements,
        visits: dentistVisits,
        entries: dentistEntries,
        collections: dentistCollections,
        chargeLines: chargeLinesByVisit,
        categories,
        adjustments: byProfile(adjustments, plan.profileId).map((row) => ({
          amount: row.amount,
          currency: row.currency,
          date: row.date,
          voided: row.voidedAt !== null,
        })),
        payouts: byProfile(payouts, plan.profileId).map((row) => ({
          amount: row.amount,
          currency: row.currency,
          date: row.date,
          voided: row.voidedAt !== null,
        })),
      };
      const computed = computeMonths(data, {
        from: plan.from,
        to: month,
        opening: plan.opening,
        late,
      });
      const last = computed.at(-1);
      if (last) results.set(plan.profileId, last);
    }
    return results;
  }
}
