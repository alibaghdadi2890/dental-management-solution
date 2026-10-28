import {
  type Adjustment,
  type Agreement,
  canReadStatement,
  type ChangeTerms,
  type CompensationExportQuery,
  type CompensationReason,
  type CompensationReport,
  type CompensationReportRow,
  type CompensationStatement,
  type CreateAgreement,
  type EndAgreement,
  type ExportLanguage,
  formatVisitNumber,
  fromCents,
  type Payout,
  type RecordAdjustment,
  type RecordPayout,
  toCents,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CLOCK } from '../../../platform/clock/clock.module';
import { PermissionDeniedError } from '../../../platform/cls/permission-denied.error';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import type { Clock } from '../../../platform/kernel/clock';
import { csvRow, UTF8_BOM } from '../../../platform/kernel/csv';
import { localDate, zonedInstant } from '../../../platform/kernel/local-date';
import { requestHash } from '../../../platform/kernel/request-hash';
import { AuditService } from '../../audit';
import { BillingService } from '../../billing';
import { VisitFactsService } from '../../clinical';
import { PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { UsersService } from '../../users';
import {
  agreementsOverlapping,
  assertCreatable,
  assertDateOpen,
  assertEndable,
  isLive,
  planDeactivation,
  planTermsChange,
} from '../domain/agreements';
import {
  AgreementNotFoundError,
  CompensationIdempotencyMismatchError,
  CompensationNotFoundError,
  NotReversibleError,
} from '../domain/compensation-errors';
import { firstDay, lastDay, monthOf, monthsBetween, nextMonth } from '../domain/months';
import { assertClosable, assertReopenable } from '../domain/periods';
import {
  ADJUSTMENT_RECORDED,
  ADJUSTMENT_VOIDED,
  AGREEMENT_CREATED,
  AGREEMENT_ENDED,
  AGREEMENT_SUPERSEDED,
  type AgreementCreated,
  type AgreementEnded,
  type AgreementSuperseded,
  type MoneyRowEvent,
  PAYOUT_RECORDED,
  PAYOUT_VOIDED,
  PERIOD_CLOSED,
  PERIOD_REOPENED,
  type PeriodEvent,
} from '../events/compensation-events';
import { AgreementsRepository, type StoredAgreement } from '../persistence/agreements.repository';
import { AdjustmentsRepository, PayoutsRepository } from '../persistence/money-rows.repository';
import { PeriodsRepository } from '../persistence/periods.repository';
import { type CompensationExportLabels, EXPORT_LABELS } from './export-labels';
import { linesOf, toAdjustment, toAgreement, toPayout, toStatement } from './presenter';
import { type DentistMonth, StatementReader } from './statement-reader';

/** The reason stored when deactivating a dentist ends their agreement (C11). */
const DEACTIVATION_REASON = 'staff deactivated';

/** A CSV export, built in memory: a statement or a report is bounded by one clinic's month. */
export interface CsvFile {
  fileName: string;
  body: string;
}

/** Whether the dentist may read their statement of `month` (ADR-0060): the latest agreement in force
 * in the month allows it. Without one there is no statement for them. */
function visibleToDentist(agreements: readonly StoredAgreement[], month: string): boolean {
  return (
    agreementsOverlapping(agreements, firstDay(month), lastDay(month)).at(-1)
      ?.statementVisibleToDentist === true
  );
}

/**
 * Dentist compensation (docs/modules/compensation.md, ADR-0058–0060): agreements, adjustments,
 * payouts and the monthly statement, closed month by month. Clinic-managed: every mutation and
 * every other dentist's statement need `compensation:manage` (a platform admin never holds it);
 * `compensation:read` is the caller's own statement. Writes of one dentist run one at a time (an
 * advisory lock on them), so a close never races an adjustment or a change of terms; each is
 * audited and publishes its event in the transaction.
 */
@Injectable()
export class CompensationService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
    private readonly users: UsersService,
    private readonly patients: PatientsService,
    private readonly billing: BillingService,
    private readonly visitFacts: VisitFactsService,
    private readonly agreements: AgreementsRepository,
    private readonly adjustments: AdjustmentsRepository,
    private readonly payouts: PayoutsRepository,
    private readonly periods: PeriodsRepository,
    private readonly reader: StatementReader,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // --- Agreements ---

  listAgreements(profileId: string): Promise<Agreement[]> {
    this.context.requirePermission('compensation:manage');
    return this.tenantDb.run(async () => {
      await this.dentistName(profileId);
      const today = await this.today();
      return (await this.agreements.list([profileId]))
        .reverse()
        .map((agreement) => toAgreement(agreement, today));
    });
  }

  async createAgreement(profileId: string, input: CreateAgreement): Promise<Agreement> {
    this.context.requirePermission('compensation:manage');
    return this.tenantDb.run(async () => {
      await this.lockDentist(profileId);
      const dentist = await this.dentistName(profileId);
      assertCreatable(input, await this.lastClosed(profileId));
      const created = await this.insertAgreement(profileId, dentist, input);
      return toAgreement(created, await this.today());
    });
  }

  /**
   * Change terms (C5, ADR-0058): the current agreement ends the day before `effectiveFrom` — or,
   * on its own first day, is superseded — and the next one starts, in one transaction. The new
   * agreement keeps the old one's end, if it had one.
   */
  async changeTerms(profileId: string, input: ChangeTerms): Promise<Agreement> {
    this.context.requirePermission('compensation:manage');
    return this.tenantDb.run(async () => {
      await this.lockDentist(profileId);
      const dentist = await this.dentistName(profileId);
      const plan = planTermsChange(
        await this.agreements.list([profileId]),
        input.effectiveFrom,
        await this.lastClosed(profileId),
      );
      let effectiveTo: string | null = null;
      if (plan.kind === 'supersede') {
        await this.supersede(plan.current, dentist, input.reason);
        effectiveTo = plan.current.effectiveTo;
      } else if (plan.kind === 'end') {
        await this.end(plan.current, dentist, plan.endOn, input.reason);
        effectiveTo = plan.current.effectiveTo;
      }
      const created = await this.insertAgreement(profileId, dentist, { ...input, effectiveTo });
      return toAgreement(created, await this.today());
    });
  }

  async endAgreement(
    profileId: string,
    agreementId: string,
    input: EndAgreement,
  ): Promise<Agreement> {
    this.context.requirePermission('compensation:manage');
    return this.tenantDb.run(async () => {
      await this.lockDentist(profileId);
      const agreement = await this.agreements.find(profileId, agreementId);
      if (!agreement) throw new AgreementNotFoundError('Agreement not found');
      assertEndable(agreement, input.date, await this.lastClosed(profileId));
      await this.end(agreement, await this.dentistName(profileId), input.date, input.reason);
      return toAgreement(
        { ...agreement, effectiveTo: input.date, endReason: input.reason },
        await this.today(),
      );
    });
  }

  /**
   * A finished visit moving to another day (ADR-0063), in the correction's transaction: refused
   * when either day is in a closed month of its dentist's pay, whose snapshot counted the visit
   * where it was (422 `compensation.period_closed`). Under the dentist's lock, so a close can't
   * slip between. A reaction of `clinical`'s correction, whose actor holds `visit:amend`: it
   * checks no permission.
   */
  async assertVisitMovable(profileId: string, from: string, to: string): Promise<void> {
    await this.tenantDb.run(async () => {
      await this.lockDentist(profileId);
      const lastClosed = await this.lastClosed(profileId);
      assertDateOpen(from, lastClosed);
      assertDateOpen(to, lastClosed);
    });
  }

  /**
   * Deactivating a dentist (C11), in the deactivation's transaction: the agreement in force ends on
   * `date` and later ones are superseded. A reaction of `users.deactivate`, whose actor holds
   * `user:write`: it checks no permission and never refuses.
   */
  async endForDeactivation(profileId: string, date: string): Promise<void> {
    await this.tenantDb.run(async () => {
      await this.lockDentist(profileId);
      const plan = planDeactivation(await this.agreements.list([profileId]), date);
      if (plan.end.length === 0 && plan.supersede.length === 0) return;
      const dentist = await this.dentistName(profileId);
      for (const agreement of plan.end) {
        await this.end(agreement, dentist, date, DEACTIVATION_REASON);
      }
      for (const agreement of plan.supersede) {
        await this.supersede(agreement, dentist, DEACTIVATION_REASON);
      }
    });
  }

  // --- Adjustments and payouts ---

  async recordAdjustment(
    profileId: string,
    input: RecordAdjustment,
    idempotencyKey: string,
  ): Promise<Adjustment> {
    this.context.requirePermission('compensation:manage');
    return this.tenantDb.run(async () => {
      await this.lockDentist(profileId);
      const idempotency = { key: idempotencyKey, hash: requestHash({ profileId, ...input }) };
      await this.adjustments.lockIdempotencyKey(idempotency.key);
      const first = await this.adjustments.findByIdempotencyKey(idempotency.key);
      if (first) {
        if (first.idempotencyHash !== idempotency.hash) throw this.mismatch();
        return toAdjustment(first);
      }
      const dentist = await this.dentistName(profileId);
      assertDateOpen(input.date, await this.lastClosed(profileId));
      const { currency } = await this.tenancy.currentTenant();
      const created = await this.adjustments.insert({
        profileId,
        ...input,
        currency,
        createdBy: this.context.requireUserId(),
        idempotency,
      });
      await this.audit.record({
        action: 'compensation.adjustment_record',
        resourceType: 'compensation_adjustment',
        resourceId: created.id,
        after: {
          profileId,
          dentist,
          kind: created.kind,
          amount: created.amount,
          currency,
          date: created.date,
        },
      });
      await this.publishMoneyRow(ADJUSTMENT_RECORDED, created.id, profileId, created.date);
      return toAdjustment(created);
    });
  }

  async voidAdjustment(
    profileId: string,
    adjustmentId: string,
    input: CompensationReason,
  ): Promise<Adjustment> {
    this.context.requirePermission('compensation:manage');
    return this.tenantDb.run(async () => {
      await this.lockDentist(profileId);
      const row = await this.adjustments.find(profileId, adjustmentId);
      if (!row) throw new CompensationNotFoundError('Adjustment not found');
      if (row.voidedAt !== null) throw new NotReversibleError('Already voided');
      assertDateOpen(row.date, await this.lastClosed(profileId));
      const dentist = await this.dentistName(profileId);
      const at = this.clock.now();
      await this.adjustments.void(row.id, {
        at,
        by: this.context.requireUserId(),
        reason: input.reason,
      });
      await this.audit.record({
        action: 'compensation.adjustment_void',
        resourceType: 'compensation_adjustment',
        resourceId: row.id,
        before: { voided: false },
        after: {
          voided: true,
          profileId,
          dentist,
          amount: row.amount,
          currency: row.currency,
          date: row.date,
        },
        reason: input.reason,
      });
      await this.publishMoneyRow(ADJUSTMENT_VOIDED, row.id, profileId, row.date);
      return toAdjustment({ ...row, voidedAt: at, voidReason: input.reason });
    });
  }

  async recordPayout(
    profileId: string,
    input: RecordPayout,
    idempotencyKey: string,
  ): Promise<Payout> {
    this.context.requirePermission('compensation:manage');
    return this.tenantDb.run(async () => {
      await this.lockDentist(profileId);
      const idempotency = { key: idempotencyKey, hash: requestHash({ profileId, ...input }) };
      await this.payouts.lockIdempotencyKey(idempotency.key);
      const first = await this.payouts.findByIdempotencyKey(idempotency.key);
      if (first) {
        if (first.idempotencyHash !== idempotency.hash) throw this.mismatch();
        return toPayout(first);
      }
      const dentist = await this.dentistName(profileId);
      assertDateOpen(input.date, await this.lastClosed(profileId));
      const { currency } = await this.tenancy.currentTenant();
      const created = await this.payouts.insert({
        profileId,
        ...input,
        currency,
        createdBy: this.context.requireUserId(),
        idempotency,
      });
      await this.audit.record({
        action: 'compensation.payout_record',
        resourceType: 'compensation_payout',
        resourceId: created.id,
        after: {
          profileId,
          dentist,
          amount: created.amount,
          currency,
          date: created.date,
          method: created.method,
        },
      });
      await this.publishMoneyRow(PAYOUT_RECORDED, created.id, profileId, created.date);
      return toPayout(created);
    });
  }

  async voidPayout(
    profileId: string,
    payoutId: string,
    input: CompensationReason,
  ): Promise<Payout> {
    this.context.requirePermission('compensation:manage');
    return this.tenantDb.run(async () => {
      await this.lockDentist(profileId);
      const row = await this.payouts.find(profileId, payoutId);
      if (!row) throw new CompensationNotFoundError('Payout not found');
      if (row.voidedAt !== null) throw new NotReversibleError('Already voided');
      assertDateOpen(row.date, await this.lastClosed(profileId));
      const dentist = await this.dentistName(profileId);
      const at = this.clock.now();
      await this.payouts.void(row.id, {
        at,
        by: this.context.requireUserId(),
        reason: input.reason,
      });
      await this.audit.record({
        action: 'compensation.payout_void',
        resourceType: 'compensation_payout',
        resourceId: row.id,
        before: { voided: false },
        after: {
          voided: true,
          profileId,
          dentist,
          amount: row.amount,
          currency: row.currency,
          date: row.date,
        },
        reason: input.reason,
      });
      await this.publishMoneyRow(PAYOUT_VOIDED, row.id, profileId, row.date);
      return toPayout({ ...row, voidedAt: at, voidReason: input.reason });
    });
  }

  // --- Statements ---

  /** A dentist's statement: any with `compensation:manage`, their own with `compensation:read`. */
  async statement(profileId: string, month: string): Promise<CompensationStatement> {
    const actor = {
      permissions: this.context.grantedPermissions(),
      profileId: this.context.staffProfileId,
    };
    if (!canReadStatement(actor, profileId)) throw new PermissionDeniedError('compensation:read');
    return this.tenantDb.run(() => this.read(profileId, month));
  }

  /** The caller's own statement; 404 when they have none that month or it is hidden from them. */
  async myStatement(month: string): Promise<CompensationStatement> {
    this.context.requirePermission('compensation:read');
    const profileId = this.context.staffProfileId;
    if (profileId === null) throw new CompensationNotFoundError('No statement');
    return this.tenantDb.run(async () => {
      const today = await this.today();
      const agreements = await this.agreements.list([profileId]);
      if (month > monthOf(today) || !visibleToDentist(agreements, month)) {
        throw new CompensationNotFoundError('No statement for that month', { month });
      }
      return this.read(profileId, month);
    });
  }

  /** The months the caller may read their statement of, newest first. */
  async myMonths(): Promise<string[]> {
    this.context.requirePermission('compensation:read');
    const profileId = this.context.staffProfileId;
    if (profileId === null) return [];
    return this.tenantDb.run(async () => {
      const agreements = (await this.agreements.list([profileId])).filter(isLive);
      const first = agreements[0];
      if (!first) return [];
      return monthsBetween(monthOf(first.effectiveFrom), monthOf(await this.today()))
        .filter((month) => visibleToDentist(agreements, month))
        .reverse();
    });
  }

  /**
   * Close a month (ADR-0059): after it has ended, in order, freezing the statement as it stands.
   * A retry with the same `Idempotency-Key` returns the statement.
   */
  async closePeriod(
    profileId: string,
    month: string,
    idempotencyKey: string,
  ): Promise<CompensationStatement> {
    this.context.requirePermission('compensation:manage');
    return this.tenantDb.run(async () => {
      await this.lockDentist(profileId);
      const hash = requestHash({ action: 'close', profileId, month });
      if (await this.replayedPeriod(idempotencyKey, hash)) return this.read(profileId, month);
      const dentist = await this.dentistName(profileId);
      const today = await this.today();
      const current = await this.month(profileId, month);
      assertClosable({
        month,
        today,
        firstMonth: current.firstMonth,
        lastClosed: current.lastClosed,
      });
      await this.periods.close({
        profileId,
        month,
        snapshot: current.view,
        lineIds: current.lineIds,
        at: this.clock.now(),
        by: this.context.requireUserId(),
        idempotency: { key: idempotencyKey, hash },
      });
      await this.recordPeriod('compensation.period_close', PERIOD_CLOSED, profileId, month, {
        after: { profileId, dentist, month, totals: current.view.totals },
      });
      return this.read(profileId, month);
    });
  }

  /** Reopen the last closed month, with a reason, while the next one is not closed. */
  async reopenPeriod(
    profileId: string,
    month: string,
    input: CompensationReason,
    idempotencyKey: string,
  ): Promise<CompensationStatement> {
    this.context.requirePermission('compensation:manage');
    return this.tenantDb.run(async () => {
      await this.lockDentist(profileId);
      const hash = requestHash({ action: 'reopen', profileId, month, ...input });
      if (await this.replayedPeriod(idempotencyKey, hash)) return this.read(profileId, month);
      const dentist = await this.dentistName(profileId);
      assertReopenable(month, await this.lastClosed(profileId));
      const period = await this.periods.find(profileId, month);
      if (!period) throw new CompensationNotFoundError('No closed month', { month });
      await this.periods.reopen(period.id, {
        at: this.clock.now(),
        by: this.context.requireUserId(),
        reason: input.reason,
        idempotency: { key: idempotencyKey, hash },
      });
      await this.recordPeriod('compensation.period_reopen', PERIOD_REOPENED, profileId, month, {
        after: { profileId, dentist, month },
        reason: input.reason,
      });
      return this.read(profileId, month);
    });
  }

  // --- The report ---

  /** Every dentist's month: active dentists always, others when they have a line. */
  async report(month: string): Promise<CompensationReport> {
    this.context.requirePermission('compensation:manage');
    return this.tenantDb.run(async () => {
      const { currency, timeZone } = await this.tenancy.currentTenant();
      const active = new Set((await this.users.listPractitioners()).map((dentist) => dentist.id));
      const range = { from: firstDay(month), to: lastDay(month) };
      const withVisits = await this.visitFacts.compensationFacts({
        ...range,
        changedSince: null,
        visitIds: [],
      });
      const withAgreements = agreementsOverlapping(
        await this.agreements.list(),
        range.from,
        range.to,
      );
      const withRows = [
        ...(await this.adjustments.list(range)),
        ...(await this.payouts.list(range)),
        ...(await this.periods.closedIn([month])),
      ];
      const ids = [
        ...new Set([
          ...active,
          ...withVisits.map((visit) => visit.dentistId),
          ...withAgreements.map((agreement) => agreement.profileId),
          ...withRows.map((row) => row.profileId),
        ]),
      ];
      const months = await this.reader.months(ids, month);
      const dentists = await this.users.practitionersByProfileIds(ids);
      const rows: CompensationReportRow[] = dentists.flatMap((dentist) => {
        const computed = months.get(dentist.id);
        if (!computed) return [];
        const { totals, report } = computed.view;
        const earned = toCents(totals.earned) + toCents(totals.late);
        return [
          {
            profileId: dentist.id,
            name: dentist.displayName,
            active: active.has(dentist.id),
            visits: report.visits,
            production: report.production,
            collections: report.collections,
            earned: report.hasAgreement || earned !== 0n ? fromCents(earned) : null,
            adjustments: totals.adjustments,
            payouts: totals.payouts,
            balance: totals.closing,
            status:
              computed.status === 'closed'
                ? 'closed'
                : report.hasAgreement
                  ? 'provisional'
                  : 'none',
          },
        ];
      });
      const unattributed = await this.billing.unattributedCollectionsBetween({
        from: zonedInstant(firstDay(month), '00:00', timeZone),
        to: zonedInstant(firstDay(nextMonth(month)), '00:00', timeZone),
      });
      const sum = (values: readonly (string | null)[]) =>
        fromCents(
          values.reduce((total, value) => total + (value === null ? 0n : toCents(value)), 0n),
        );
      return {
        month,
        currency,
        rows,
        unattributed: {
          collections: unattributed.find((row) => row.currency === currency)?.amount ?? '0.00',
        },
        kpis: {
          production: sum(rows.map((row) => row.production)),
          collections: sum(rows.map((row) => row.collections)),
          earned: sum(rows.map((row) => row.earned)),
          balanceOwed: sum(rows.map((row) => row.balance)),
        },
      };
    });
  }

  async exportReport(query: CompensationExportQuery): Promise<CsvFile> {
    const report = await this.report(query.month);
    const labels = await this.labels(query.lang);
    const numeric = { numericColumns: [1, 2, 3, 4, 5, 6, 7] };
    const header = csvRow([
      labels.report.dentist,
      labels.report.visits,
      labels.report.production,
      labels.report.collections,
      labels.report.earned,
      labels.report.adjustments,
      labels.report.payouts,
      labels.report.balance,
      labels.report.status,
    ]);
    const body = report.rows.map((row) =>
      csvRow(
        [
          row.name,
          String(row.visits),
          row.production,
          row.collections,
          row.earned ?? '',
          row.adjustments,
          row.payouts,
          row.balance,
          labels.statuses[row.status],
        ],
        numeric,
      ),
    );
    const unattributed = csvRow(
      [labels.report.unattributed, '', '', report.unattributed.collections, '', '', '', '', ''],
      numeric,
    );
    return {
      fileName: `compensation-${query.month}.csv`,
      body: UTF8_BOM + header + body.join('') + unattributed,
    };
  }

  async exportStatement(profileId: string, query: CompensationExportQuery): Promise<CsvFile> {
    const statement = await this.statement(profileId, query.month);
    const labels = await this.labels(query.lang);
    const s = labels.statement;
    const numeric = { numericColumns: [5, 6, 7, 8] };
    const lines: string[] = [
      csvRow([s.section, s.date, s.visit, s.patient, '', s.base, s.rate, s.count, s.amount]),
    ];
    const line = (section: string, row: CompensationStatement['earned'][number]['lines'][number]) =>
      csvRow(
        [
          section,
          row.date,
          row.visitNumber === null ? '' : formatVisitNumber(row.visitNumber),
          row.patientName ?? '',
          row.kind === 'threshold' ? s.threshold : '',
          row.base ?? '',
          row.rate?.percent ?? '',
          row.count === null ? '' : String(row.count),
          row.amount,
        ],
        numeric,
      );
    for (const group of statement.earned) {
      for (const row of group.lines) lines.push(line(labels.components[group.component], row));
    }
    for (const group of statement.late) {
      for (const row of group.lines) lines.push(line(`${s.late} ${group.month}`, row));
    }
    for (const row of statement.noAgreement) lines.push(line(s.noAgreement, row));
    for (const row of statement.notComputed) lines.push(line(s.notComputed, row));
    for (const row of statement.adjustments) {
      const amount = row.voidedAt === null ? row.amount : '';
      lines.push(
        csvRow(
          [
            labels.report.adjustments,
            row.date,
            '',
            row.note ?? '',
            labels.adjustmentKinds[row.kind],
            '',
            '',
            '',
            amount || s.voided,
          ],
          numeric,
        ),
      );
    }
    for (const row of statement.payouts) {
      const amount = row.voidedAt === null ? fromCents(-toCents(row.amount)) : '';
      lines.push(
        csvRow(
          [
            labels.report.payouts,
            row.date,
            '',
            row.reference ?? '',
            labels.methods[row.method],
            '',
            '',
            '',
            amount || s.voided,
          ],
          numeric,
        ),
      );
    }
    const total = (label: string, amount: string) =>
      csvRow([label, '', '', '', '', '', '', '', amount], numeric);
    lines.push(
      total(s.opening, statement.totals.opening),
      total(labels.report.earned, statement.totals.earned),
      total(s.late, statement.totals.late),
      total(labels.report.adjustments, statement.totals.adjustments),
      total(labels.report.payouts, statement.totals.payouts),
      total(s.closing, statement.totals.closing),
    );
    return { fileName: `statement-${query.month}.csv`, body: UTF8_BOM + lines.join('') };
  }

  // --- Shared ---

  /** The statement of a dentist's month, with names; inside the caller's transaction. */
  private async read(profileId: string, month: string): Promise<CompensationStatement> {
    const dentistName = await this.dentistName(profileId);
    const computed = await this.month(profileId, month);
    const { currency } = await this.tenancy.currentTenant();
    const patientIds = [
      ...new Set(
        linesOf(computed).flatMap((line) => (line.patientId === null ? [] : [line.patientId])),
      ),
    ];
    // Names need `patient:read`, which every clinic role holds; without it lines stay unnamed.
    const patientNames =
      patientIds.length > 0 && this.context.hasPermission('patient:read')
        ? new Map(
            (await this.patients.names(patientIds)).map((patient) => [
              patient.id,
              patient.fullName,
            ]),
          )
        : new Map<string, string>();
    return toStatement(computed, {
      dentistName,
      currency,
      today: await this.today(),
      patientNames,
    });
  }

  private async month(profileId: string, month: string): Promise<DentistMonth> {
    const computed = (await this.reader.months([profileId], month)).get(profileId);
    if (!computed) throw new Error(`No statement computed for ${profileId}`);
    return computed;
  }

  /** The dentist's display name; a profile that is not this tenant's staff → 404. */
  private async dentistName(profileId: string): Promise<string> {
    const [dentist] = await this.users.practitionersByProfileIds([profileId]);
    if (!dentist) throw new CompensationNotFoundError('No such dentist', { profileId });
    return dentist.displayName;
  }

  /** One dentist's compensation writes run one at a time, to the end of the transaction. */
  private async lockDentist(profileId: string): Promise<void> {
    await this.tenantDb.run((tx) =>
      tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`compensation:${profileId}`}, 0))`,
      ),
    );
  }

  private async lastClosed(profileId: string): Promise<string | null> {
    return (await this.periods.lastClosed([profileId])).get(profileId)?.month ?? null;
  }

  private async today(): Promise<string> {
    const { timeZone } = await this.tenancy.currentTenant();
    return localDate(this.clock.now(), timeZone);
  }

  private async labels(lang: ExportLanguage | undefined): Promise<CompensationExportLabels> {
    return EXPORT_LABELS[
      lang ?? (await this.tenantDb.run(() => this.tenancy.currentTenant())).locale
    ];
  }

  private mismatch(): CompensationIdempotencyMismatchError {
    return new CompensationIdempotencyMismatchError(
      'This Idempotency-Key was used for a different request',
    );
  }

  /** A close or reopen already made under this key: true to replay it, a mismatch refused. */
  private async replayedPeriod(key: string, hash: string): Promise<boolean> {
    const first = await this.periods.findByIdempotencyKey(key);
    if (!first) return false;
    if (first.idempotencyHash !== hash) throw this.mismatch();
    return true;
  }

  private async insertAgreement(
    profileId: string,
    dentist: string,
    input: Omit<CreateAgreement, 'effectiveTo'> & { effectiveTo: string | null },
  ): Promise<StoredAgreement> {
    const created = await this.agreements.insert({
      profileId,
      preset: input.preset,
      components: input.components,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      statementVisibleToDentist: input.statementVisibleToDentist,
      note: input.note,
      createdBy: this.context.requireUserId(),
    });
    await this.audit.record({
      action: 'compensation.agreement_create',
      resourceType: 'compensation_agreement',
      resourceId: created.id,
      after: {
        profileId,
        dentist,
        preset: created.preset,
        components: created.components,
        effectiveFrom: created.effectiveFrom,
        effectiveTo: created.effectiveTo,
        statementVisibleToDentist: created.statementVisibleToDentist,
      },
    });
    const event: AgreementCreated = this.events.create(AGREEMENT_CREATED, {
      agreementId: created.id,
      profileId,
      effectiveFrom: created.effectiveFrom,
    });
    await this.events.publish(event);
    return created;
  }

  private async end(
    agreement: StoredAgreement,
    dentist: string,
    effectiveTo: string,
    reason: string | null,
  ) {
    await this.agreements.end(agreement.id, {
      effectiveTo,
      at: this.clock.now(),
      by: this.context.requireUserId(),
      reason,
    });
    await this.audit.record({
      action: 'compensation.agreement_end',
      resourceType: 'compensation_agreement',
      resourceId: agreement.id,
      before: { effectiveTo: agreement.effectiveTo },
      after: { profileId: agreement.profileId, dentist, effectiveTo },
      reason: reason ?? undefined,
    });
    const event: AgreementEnded = this.events.create(AGREEMENT_ENDED, {
      agreementId: agreement.id,
      profileId: agreement.profileId,
      effectiveTo,
    });
    await this.events.publish(event);
  }

  private async supersede(agreement: StoredAgreement, dentist: string, reason: string | null) {
    await this.agreements.supersede(agreement.id, {
      at: this.clock.now(),
      by: this.context.requireUserId(),
      reason,
    });
    await this.audit.record({
      action: 'compensation.agreement_supersede',
      resourceType: 'compensation_agreement',
      resourceId: agreement.id,
      before: { superseded: false },
      after: { profileId: agreement.profileId, dentist, superseded: true },
      reason: reason ?? undefined,
    });
    const event: AgreementSuperseded = this.events.create(AGREEMENT_SUPERSEDED, {
      agreementId: agreement.id,
      profileId: agreement.profileId,
    });
    await this.events.publish(event);
  }

  private async publishMoneyRow(
    name: MoneyRowEvent['name'],
    id: string,
    profileId: string,
    date: string,
  ): Promise<void> {
    const event: MoneyRowEvent = this.events.create(name, { id, profileId, date });
    await this.events.publish(event);
  }

  private async recordPeriod(
    action: 'compensation.period_close' | 'compensation.period_reopen',
    name: PeriodEvent['name'],
    profileId: string,
    month: string,
    details: { after: unknown; reason?: string },
  ): Promise<void> {
    const period = await this.periods.find(profileId, month);
    await this.audit.record({
      action,
      resourceType: 'compensation_period',
      resourceId: period?.id ?? `${profileId}:${month}`,
      after: details.after,
      reason: details.reason,
    });
    const event: PeriodEvent = this.events.create(name, { profileId, month });
    await this.events.publish(event);
  }
}
