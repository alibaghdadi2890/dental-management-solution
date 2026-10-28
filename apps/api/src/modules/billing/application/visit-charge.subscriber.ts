import { fromCents, toCents } from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import { OnDomainEventInTransaction } from '../../../platform/events/event-bus';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate } from '../../../platform/kernel/local-date';
import {
  VISIT_AMENDED,
  VISIT_COMPLETED,
  VISIT_VOIDED,
  type VisitAmended,
  type VisitChargeFacts,
  type VisitCompleted,
  VisitFactsService,
  type VisitVoided,
} from '../../clinical';
import { PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import type { NewLedgerEntry } from '../persistence/ledger-entries.repository';
import { LedgerEntriesRepository } from '../persistence/ledger-entries.repository';
import { PlanSharesRepository } from '../persistence/plan-shares.repository';
import { VisitHasPaymentsError } from '../domain/visit-payment-errors';
import { BillingService } from './billing.service';
import { LedgerWriter } from './ledger-writer';
import { Settlement } from './settlement';

/** A visit entry's lines: the visit's services in order, in its currency (none without facts). */
function linesOf(facts: VisitChargeFacts | null) {
  if (!facts) return [];
  return facts.lines.map((line, index) => ({
    position: index + 1,
    ...line,
    currency: facts.currency,
  }));
}

/**
 * The visit's side of the ledger, as in-transaction handlers of `clinical`'s visit events: they
 * run in the triggering request's context and transaction, before commit, so the visit change
 * and its ledger entry commit together or not at all.
 *
 * - `VisitCompleted` posts the visit charge (spec W2, ADR-0024). A zero total posts nothing
 *   (W20: the ledger refuses 0). A second charge violates `ledger_entries_visit_kind_unique`;
 *   that can only be a bug, so it is raised, not ignored.
 * - `VisitAmended` posts the amendment's difference as a `visit_charge_adjustment` (4b, D7),
 *   negative for a credit, nothing for a zero delta, with the visit's lines as they stand after
 *   it (ADR-0062: what `compensation` rates). A discount set at checkout arrives the same way,
 *   possibly without a reason.
 * - `VisitVoided` reverses what the visit charges now (charge plus adjustments) with a
 *   `visit_charge_reversal`, nothing when that nets to zero — or vetoes the void when payments
 *   sit on the visit (ADR-0026).
 *
 * Each entry is followed by a settle (feature 5, P4): credit covers a new charge, and an amount
 * taken off a covered visit is released and re-applied. Before it, a completion or an amendment
 * stores the visit's plan share (ADR-0051 A4): what money held for the plan may cover of it.
 *
 * Adjustments and reversals are dated the tenant's today and carry the reason; a reversal has no
 * lines. The before/after is `clinical`'s `visit_amendments` row (D7). Not gated by `payment:write`: the
 * trigger already required `visit:write`, `visit:amend`, `visit:discount` or `visit:void`.
 */
@Injectable()
export class VisitChargeSubscriber {
  constructor(
    private readonly context: RequestContext,
    private readonly patients: PatientsService,
    private readonly tenancy: TenancyService,
    private readonly visits: VisitFactsService,
    private readonly billing: BillingService,
    private readonly entries: LedgerEntriesRepository,
    private readonly planShares: PlanSharesRepository,
    private readonly writer: LedgerWriter,
    private readonly settlement: Settlement,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @OnDomainEventInTransaction(VISIT_COMPLETED)
  async onVisitCompleted(event: VisitCompleted): Promise<void> {
    if (toCents(event.payload.total) === 0n) return;
    const facts = await this.visits.chargeFacts(event.payload.visitId);
    await this.storePlanShare(event.payload.visitId, facts);
    await this.recordVisitCharge(event.payload.visitId, facts);
  }

  @OnDomainEventInTransaction(VISIT_AMENDED)
  async onVisitAmended(event: VisitAmended): Promise<void> {
    const { visitId, patientId, amendmentId, currency, delta, reason } = event.payload;
    // A correction may change which lines perform a plan without changing the total.
    const facts = await this.visits.chargeFacts(visitId);
    await this.storePlanShare(visitId, facts);
    if (toCents(delta) === 0n) return;
    await this.appendCorrection(
      {
        kind: 'visit_charge_adjustment',
        visitId,
        patientId,
        currency,
        amount: delta,
        reason,
        amendmentId,
      },
      facts,
    );
  }

  @OnDomainEventInTransaction(VISIT_VOIDED)
  async onVisitVoided(event: VisitVoided): Promise<void> {
    const { visitId, patientId, currency, reason } = event.payload;
    // Under the account lock, so a payment can't land on the visit between the check and the
    // reversal (ADR-0026, P8).
    await this.patients.lockForDependentWrite(patientId);
    await this.settlement.lock([patientId]);
    if (toCents(await this.billing.paidOn(visitId)) > 0n) {
      throw new VisitHasPaymentsError(
        'This visit has payments; refund or move them before voiding it',
      );
    }
    const charged = (await this.entries.listForVisit(visitId))
      .filter((entry) => entry.currency === currency)
      .reduce((sum, entry) => sum + toCents(entry.amount), 0n);
    if (charged === 0n) return;
    await this.appendCorrection({
      kind: 'visit_charge_reversal',
      visitId,
      patientId,
      currency,
      amount: fromCents(-charged),
      reason,
      amendmentId: null,
    });
  }

  /**
   * The `visit_charge` entry — the visit total, on its local date, by the completing user (W10) —
   * and its lines. The patient lock is already held by `complete` (re-entrant).
   */
  private async recordVisitCharge(visitId: string, facts: VisitChargeFacts): Promise<void> {
    await this.patients.lockForDependentWrite(facts.patientId);
    await this.writer.append(
      {
        patientId: facts.patientId,
        kind: 'visit_charge',
        amount: facts.total,
        currency: facts.currency,
        effectiveDate: facts.localDate,
        note: null,
        reason: null,
        createdBy: this.context.requireUserId(),
        visitId,
        amendmentId: null,
      },
      linesOf(facts),
    );
    // Existing credit covers the new charge at once (P4).
    await this.settlement.settle(facts.patientId);
  }

  /** Σ the lines that perform a plan item, as the visit stands now (ADR-0051 A4). */
  private async storePlanShare(visitId: string, facts: VisitChargeFacts): Promise<void> {
    const share = facts.lines
      .filter((line) => line.planId !== null)
      .reduce((sum, line) => sum + toCents(line.amount), 0n);
    await this.planShares.upsert(visitId, fromCents(share), facts.currency);
  }

  /**
   * An adjustment or reversal on the tenant's today; `amend`/`void` hold the patient lock. An
   * adjustment carries the visit's lines as they stand after it (`facts`).
   */
  private async appendCorrection(
    entry: Pick<
      NewLedgerEntry,
      'kind' | 'visitId' | 'patientId' | 'currency' | 'amount' | 'reason' | 'amendmentId'
    >,
    facts: VisitChargeFacts | null = null,
  ): Promise<void> {
    await this.patients.lockForDependentWrite(entry.patientId);
    const { timeZone } = await this.tenancy.currentTenant();
    await this.writer.append(
      {
        ...entry,
        effectiveDate: localDate(this.clock.now(), timeZone),
        note: null,
        createdBy: this.context.requireUserId(),
      },
      linesOf(facts),
    );
    // An amendment down (or a void) releases what payments covered above the new charge; the
    // freed money covers other open charges or stays as credit (P4).
    await this.settlement.settle(entry.patientId);
  }
}
