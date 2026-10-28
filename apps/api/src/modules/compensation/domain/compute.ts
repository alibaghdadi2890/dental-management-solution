import {
  type AgreementComponent,
  type ComponentKind,
  type EarnedGroup,
  fromCents,
  type LateGroup,
  type MonthlyFixedComponent,
  type PerDayComponent,
  type PerVisitComponent,
  type ShareBasis,
  type ShareComponent,
  type StatementLine,
  type StatementSourceKind,
  type StatementTotals,
  toCents,
  type VisitType,
} from '@dcm/contracts';
import { type AgreementRecord, agreementOn, agreementsOverlapping } from './agreements';
import { type ChargeHistory, collectionShare, entryShare } from './blend';
import { roundDiv } from './money';
import { daysBetween, daysInMonth, firstDay, lastDay, monthOf, monthsBetween } from './months';

/**
 * The monthly statement of one dentist (ADR-0059), pure: no I/O, no clock. Open months are
 * computed from the ledger and the visits; closed months are their snapshot and never reach this
 * function. Every line carries a stable id — the entry, allocation, visit or day it comes from —
 * and a closed month remembers the ids it counted (`included`), so a line of a closed month that
 * is not among them is a late entry of the first open month, and nothing is counted twice.
 */

/** A completed visit of the dentist (voided and imported ones included, flagged). */
export interface VisitFact {
  visitId: string;
  displayNumber: number;
  dentistId: string;
  patientId: string;
  localDate: string;
  type: VisitType;
  /** The visit's net total, null when never charged. */
  total: string | null;
  voided: boolean;
  imported: boolean;
}

/** A visit-kind ledger entry (production): dated by its effective date. */
export interface EntryFact {
  id: string;
  visitId: string;
  kind: 'visit_charge' | 'visit_charge_adjustment' | 'visit_charge_reversal';
  amount: string;
  currency: string;
  date: string;
}

/** A payment-sourced allocation row onto a visit entry (collection): dated by its local creation. */
export interface CollectionFact {
  id: string;
  visitId: string;
  kind: 'allocation' | 'credit_applied' | 'release';
  amount: string;
  currency: string;
  date: string;
}

/** An adjustment or a payout, as far as totals go. */
export interface MoneyRow {
  amount: string;
  currency: string;
  date: string;
  voided: boolean;
}

/** Everything known about one dentist for the months computed. */
export interface DentistData {
  currency: string;
  agreements: readonly AgreementRecord[];
  /** The dentist's visits: those of the months computed and every visit a fact names. */
  visits: ReadonlyMap<string, VisitFact>;
  entries: readonly EntryFact[];
  collections: readonly CollectionFact[];
  /** The visits' entries with their lines, by visit: only loaded when rates differ by service. */
  histories: ReadonlyMap<string, ChargeHistory>;
  categories: ReadonlyMap<string, string | null>;
  adjustments: readonly MoneyRow[];
  payouts: readonly MoneyRow[];
}

/** The closed months before the first open one: the last closed month, and which of the candidate
 * line ids a closed snapshot already counted. */
export interface LateContext {
  lastClosed: string;
  included: ReadonlySet<string>;
}

export interface MonthResult {
  month: string;
  earned: EarnedGroup[];
  late: LateGroup[];
  /** Billed lines of visits with no agreement on their date: shown with rate "—", earning 0. */
  noAgreement: StatementLine[];
  notComputed: StatementLine[];
  totals: StatementTotals;
  closing: bigint;
  /** Every line id of the month, late ones included: what its snapshot remembers. */
  lineIds: string[];
  report: { visits: number; production: bigint; collections: bigint; hasAgreement: boolean };
}

const COMPONENT_ORDER: readonly ComponentKind[] = ['monthlyFixed', 'share', 'perVisit', 'perDay'];

function componentOf<K extends AgreementComponent['kind']>(
  agreement: AgreementRecord | undefined,
  kind: K,
): Extract<AgreementComponent, { kind: K }> | undefined {
  return agreement?.components.find(
    (component): component is Extract<AgreementComponent, { kind: K }> => component.kind === kind,
  );
}

/** An input amount (`15`, `1500.5`) as shown and stored: exactly 2 decimals. */
function normalized(amount: string): string {
  return fromCents(toCents(amount));
}

function sumCents(values: readonly string[]): bigint {
  return values.reduce((sum, value) => sum + toCents(value), 0n);
}

function byDate(a: StatementLine, b: StatementLine): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const numbers = (a.visitNumber ?? 0) - (b.visitNumber ?? 0);
  if (numbers !== 0) return numbers;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Counts towards per-visit and per-day pay: completed (always, here), not voided, not imported
 * (imported history was never charged and earns nothing). */
function counts(visit: VisitFact): boolean {
  return !visit.voided && !visit.imported;
}

/** How many times a per-visit or per-day line of a closed month may be paid again and taken
 * back again after the close (a visit voided, then another counted on its day). */
const MAX_GENERATIONS = 5;

const generationId = (base: string, generation: number) =>
  generation === 1 ? base : `${base}:${String(generation)}`;

/**
 * Every id a per-visit or per-day line can have once its month is closed (ADR-0059): `visit:X`,
 * then its reversal `visit:X:void`, a later payment `visit:X:2`, `visit:X:2:void`, and so on.
 */
export function generationIds(base: string): string[] {
  const ids: string[] = [];
  for (let generation = 1; generation <= MAX_GENERATIONS; generation += 1) {
    const id = generationId(base, generation);
    ids.push(id, `${id}:void`);
  }
  return ids;
}

/** The line a closed month's visit or day needs now: paid again, taken back, or none. */
function nextGeneration(
  base: string,
  eligible: boolean,
  included: ReadonlySet<string>,
): { id: string; sign: 1n | -1n } | null {
  let generation = 0;
  let counted = false;
  for (let candidate = 1; candidate <= MAX_GENERATIONS; candidate += 1) {
    const id = generationId(base, candidate);
    if (!included.has(id)) break;
    generation = candidate;
    counted = !included.has(`${id}:void`);
    if (counted) break;
  }
  if (eligible && !counted && generation < MAX_GENERATIONS) {
    return { id: generationId(base, generation + 1), sign: 1n };
  }
  if (!eligible && counted) return { id: `${generationId(base, generation)}:void`, sign: -1n };
  return null;
}

function perVisitUnit(component: PerVisitComponent, visit: VisitFact): string {
  return component.byType[visit.type] ?? component.amount;
}

function earnsPerVisit(component: PerVisitComponent, visit: VisitFact): boolean {
  if (!counts(visit)) return false;
  return !component.chargedOnly || (visit.total !== null && toCents(visit.total) > 0n);
}

export function computeMonth(
  data: DentistData,
  month: string,
  opening: bigint,
  late: LateContext | null,
): MonthResult {
  const { currency } = data;
  const earned = new Map<ComponentKind, StatementLine[]>();
  const lateLines: StatementLine[] = [];
  const noAgreement: StatementLine[] = [];
  const notComputed: StatementLine[] = [];
  const shares: { agreementId: string; base: bigint; amount: bigint }[] = [];
  const report = { visits: 0, production: 0n, collections: 0n, hasAgreement: false };

  const blank = (id: string, kind: StatementLine['kind'], date: string): StatementLine => ({
    id,
    kind,
    date,
    agreementId: null,
    visitId: null,
    visitNumber: null,
    patientId: null,
    patientName: null,
    visitType: null,
    source: null,
    reversal: false,
    base: null,
    rate: null,
    count: null,
    unitAmount: null,
    amount: '0.00',
    currency,
  });
  const ofVisit = (line: StatementLine, visit: VisitFact): StatementLine => ({
    ...line,
    visitId: visit.visitId,
    visitNumber: visit.displayNumber,
    patientId: visit.patientId,
    visitType: visit.type,
  });
  const isLate = (date: string, id: string) =>
    late !== null && monthOf(date) <= late.lastClosed && !late.included.has(id);
  const place = (line: StatementLine, component: ComponentKind, own: boolean) => {
    if (own) earned.set(component, [...(earned.get(component) ?? []), line]);
    else lateLines.push(line);
  };

  // Shares: billed (production) and collected (collection) lines, at the rate in force on the
  // visit's date, whatever the date of the money.
  const moneyFacts: {
    id: string;
    visitId: string;
    source: StatementSourceKind;
    amount: string;
    currency: string;
    date: string;
    basis: ShareBasis;
  }[] = [
    ...data.entries.map((entry) => ({
      ...entry,
      source: entry.kind,
      basis: 'production' as const,
    })),
    ...data.collections.map((row) => ({ ...row, source: row.kind, basis: 'collection' as const })),
  ];
  for (const fact of moneyFacts) {
    const own = monthOf(fact.date) === month;
    if (!own && !isLate(fact.date, fact.id)) continue;
    const visit = data.visits.get(fact.visitId);
    if (!visit) continue;
    const kind = fact.basis === 'production' ? 'production' : 'collection';
    const base = ofVisit({ ...blank(fact.id, kind, fact.date), source: fact.source }, visit);
    if (fact.currency !== currency) {
      notComputed.push({ ...base, base: fact.amount, currency: fact.currency });
      continue;
    }
    if (own && fact.basis === 'production') report.production += toCents(fact.amount);
    if (own && fact.basis === 'collection') report.collections += toCents(fact.amount);
    const agreement = agreementOn(data.agreements, visit.localDate);
    if (!agreement) {
      if (own && fact.basis === 'production') noAgreement.push({ ...base, base: fact.amount });
      continue;
    }
    const share: ShareComponent | undefined = componentOf(agreement, 'share');
    if (!share || share.basis !== fact.basis) continue;
    const history = data.histories.get(visit.visitId);
    const { amount, rate } =
      fact.basis === 'production'
        ? entryShare(share, fact, history, data.categories)
        : collectionShare(share, fact.amount, history, data.categories);
    shares.push({ agreementId: agreement.id, base: toCents(fact.amount), amount });
    place(
      {
        ...base,
        agreementId: agreement.id,
        base: fact.amount,
        rate,
        amount: fromCents(amount),
      },
      'share',
      own,
    );
  }

  // Per visit, and per day: a day with at least one counted visit.
  const days = new Map<
    string,
    { counted: number; component: PerDayComponent; agreementId: string }
  >();
  for (const visit of data.visits.values()) {
    const own = monthOf(visit.localDate) === month;
    const closed = late !== null && monthOf(visit.localDate) <= late.lastClosed;
    if (!own && !closed) continue;
    if (own && counts(visit)) report.visits += 1;
    const agreement = agreementOn(data.agreements, visit.localDate);
    const perDay = componentOf(agreement, 'perDay');
    if (agreement && perDay) {
      const day = days.get(visit.localDate) ?? {
        counted: 0,
        component: perDay,
        agreementId: agreement.id,
      };
      if (counts(visit)) day.counted += 1;
      days.set(visit.localDate, day);
    }
    const perVisit = componentOf(agreement, 'perVisit');
    if (!agreement || !perVisit) continue;
    const unit = perVisitUnit(perVisit, visit);
    const line = (id: string, sign: 1n | -1n) =>
      ofVisit(
        {
          ...blank(id, 'perVisit', visit.localDate),
          agreementId: agreement.id,
          reversal: sign < 0n,
          count: sign < 0n ? -1 : 1,
          unitAmount: normalized(unit),
          amount: fromCents(toCents(unit) * sign),
        },
        visit,
      );
    const id = `visit:${visit.visitId}`;
    const eligible = earnsPerVisit(perVisit, visit);
    if (own) {
      if (eligible) place(line(id, 1n), 'perVisit', true);
    } else if (late !== null) {
      const next = nextGeneration(id, eligible, late.included);
      if (next) place(line(next.id, next.sign), 'perVisit', false);
    }
  }
  for (const [date, day] of days) {
    const own = monthOf(date) === month;
    const line = (id: string, sign: 1n | -1n): StatementLine => ({
      ...blank(id, 'perDay', date),
      agreementId: day.agreementId,
      reversal: sign < 0n,
      count: day.counted,
      unitAmount: normalized(day.component.amount),
      amount: fromCents(toCents(day.component.amount) * sign),
    });
    const id = `day:${date}`;
    if (own) {
      if (day.counted > 0) place(line(id, 1n), 'perDay', true);
    } else if (late !== null) {
      const next = nextGeneration(id, day.counted > 0, late.included);
      if (next) place(line(next.id, next.sign), 'perDay', false);
    }
  }

  // Fixed amounts, pro-rated by the calendar days the agreement covers in the month. Without
  // pro-rating the whole amount is paid once, by the month's last agreement with one.
  const inMonth = agreementsOverlapping(data.agreements, firstDay(month), lastDay(month));
  report.hasAgreement = inMonth.length > 0;
  for (const [index, agreement] of inMonth.entries()) {
    const fixed: MonthlyFixedComponent | undefined = componentOf(agreement, 'monthlyFixed');
    if (!fixed) continue;
    const replaced = inMonth
      .slice(index + 1)
      .some((later) => componentOf(later, 'monthlyFixed') !== undefined);
    if (!fixed.prorate && replaced) continue;
    const from =
      agreement.effectiveFrom > firstDay(month) ? agreement.effectiveFrom : firstDay(month);
    const to =
      agreement.effectiveTo !== null && agreement.effectiveTo < lastDay(month)
        ? agreement.effectiveTo
        : lastDay(month);
    const covered = daysBetween(from, to);
    const amount = fixed.prorate
      ? roundDiv(toCents(fixed.amount) * BigInt(covered), BigInt(daysInMonth(month)))
      : toCents(fixed.amount);
    place(
      {
        ...blank(`fixed:${agreement.id}:${month}`, 'fixed', from),
        agreementId: agreement.id,
        count: covered,
        unitAmount: normalized(fixed.amount),
        amount: fromCents(amount),
      },
      'monthlyFixed',
      true,
    );
  }

  // Threshold, per statement month and agreement (late lines included): the shares apply only to
  // the part of the base above it; one line carries the difference. A base of zero or less is
  // corrections only (voids, refunds): they claw back in full.
  const byAgreement = new Map<string, { base: bigint; amount: bigint }>();
  for (const share of shares) {
    const sum = byAgreement.get(share.agreementId) ?? { base: 0n, amount: 0n };
    sum.base += share.base;
    sum.amount += share.amount;
    byAgreement.set(share.agreementId, sum);
  }
  for (const [agreementId, sum] of byAgreement) {
    const agreement = data.agreements.find((candidate) => candidate.id === agreementId);
    const threshold = componentOf(agreement, 'share')?.threshold ?? null;
    if (threshold === null || sum.base <= 0n) continue;
    const limit = toCents(threshold);
    const kept = sum.base <= limit ? 0n : roundDiv(sum.amount * (sum.base - limit), sum.base);
    place(
      {
        ...blank(`threshold:${agreementId}:${month}`, 'threshold', lastDay(month)),
        agreementId,
        base: fromCents(sum.base),
        unitAmount: normalized(threshold),
        amount: fromCents(kept - sum.amount),
      },
      'share',
      true,
    );
  }

  const earnedGroups: EarnedGroup[] = COMPONENT_ORDER.flatMap((component) => {
    const lines = earned.get(component);
    if (!lines || lines.length === 0) return [];
    const sorted = lines
      .filter((line) => line.kind !== 'threshold')
      .sort(byDate)
      .concat(lines.filter((line) => line.kind === 'threshold'));
    return [
      { component, lines: sorted, total: fromCents(sumCents(lines.map((line) => line.amount))) },
    ];
  });
  const lateGroups: LateGroup[] = [...new Set(lateLines.map((line) => monthOf(line.date)))]
    .sort()
    .map((lateMonth) => {
      const lines = lateLines.filter((line) => monthOf(line.date) === lateMonth).sort(byDate);
      return {
        month: lateMonth,
        lines,
        total: fromCents(sumCents(lines.map((line) => line.amount))),
      };
    });

  const inThisMonth = (row: MoneyRow) =>
    !row.voided && row.currency === currency && monthOf(row.date) === month;
  const earnedTotal = sumCents(earnedGroups.map((group) => group.total));
  const lateTotal = sumCents(lateGroups.map((group) => group.total));
  const adjustments = sumCents(data.adjustments.filter(inThisMonth).map((row) => row.amount));
  const payouts = sumCents(data.payouts.filter(inThisMonth).map((row) => row.amount));
  const closing = opening + earnedTotal + lateTotal + adjustments - payouts;

  return {
    month,
    earned: earnedGroups,
    late: lateGroups,
    noAgreement: noAgreement.sort(byDate),
    notComputed: notComputed.sort(byDate),
    totals: {
      opening: fromCents(opening),
      earned: fromCents(earnedTotal),
      late: fromCents(lateTotal),
      adjustments: fromCents(adjustments),
      payouts: fromCents(payouts),
      closing: fromCents(closing),
    },
    closing,
    lineIds: [
      ...earnedGroups.flatMap((group) => group.lines.map((line) => line.id)),
      ...lateGroups.flatMap((group) => group.lines.map((line) => line.id)),
      ...noAgreement.map((line) => line.id),
      ...notComputed.map((line) => line.id),
    ],
    report,
  };
}

/**
 * The open months from `from` to `to` in order, each opening with the previous closing (the first
 * with `opening`, the last closed month's closing or 0); late entries go to `from`, the first open
 * month. Returns every month computed, oldest first.
 */
export function computeMonths(
  data: DentistData,
  range: { from: string; to: string; opening: bigint; late: LateContext | null },
): MonthResult[] {
  const results: MonthResult[] = [];
  let opening = range.opening;
  for (const month of monthsBetween(range.from, range.to)) {
    const result = computeMonth(data, month, opening, month === range.from ? range.late : null);
    results.push(result);
    opening = result.closing;
  }
  return results;
}
