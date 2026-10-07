import {
  type AllocationLine,
  type ContactView,
  type Family,
  type FamilyStatement,
  type OutstandingQuery,
  formatReceiptNumber,
  formatVisitNumber,
  fromCents,
  type LedgerEntryKind,
  type OpenCharge,
  type OutstandingPage,
  type PatientAccount,
  type PatientRef,
  type Payer,
  type AccountAdjustment,
  type PaymentHistoryItem,
  type PaymentKind,
  type PaymentMethod,
  patientListQuerySchema,
  type Receipt,
  type Receivables,
  type Statement,
  type Tenant,
  toCents,
  type Transaction,
  type TransactionExportQuery,
  type TransactionFilters,
  type TransactionPage,
  type TransactionQuery,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate } from '../../../platform/kernel/local-date';
import { VisitsService } from '../../clinical';
import { ContactsService, PatientNotFoundError, PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { UsersService } from '../../users';
import { addDays, agingBucket, agingTotals } from '../domain/aging';
import { byAge, outstandingByTarget, unallocatedBySource } from '../domain/allocate';
import { csvRow, UTF8_BOM } from '../domain/csv';
import type { AccountTarget, Payment } from '../domain/payment';
import { decodeDateIdCursor, encodeDateIdCursor } from '../domain/payment-cursor';
import { PaymentNotFoundError } from '../domain/payment-errors';
import { runningBalance } from '../domain/running-balance';
import { AllocationsRepository } from '../persistence/allocations.repository';
import { LedgerEntriesRepository } from '../persistence/ledger-entries.repository';
import { type TransactionCriteria, PaymentsRepository } from '../persistence/payments.repository';
import { ChargeLabels } from './charge-labels';
import { PaymentsService } from './payments.service';

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;

/** The Transactions export's header row and value labels, in the caller's language. */
export interface TransactionExportLabels {
  date: string;
  receipt: string;
  patient: string;
  patientId: string;
  type: string;
  method: string;
  visits: string;
  recordedBy: string;
  amount: string;
  reference: string;
  reason: string;
  kinds: Record<PaymentKind, string>;
  methods: Record<PaymentMethod, string>;
}

const sum = (values: Iterable<bigint>) => [...values].reduce((total, value) => total + value, 0n);
const max0 = (value: bigint) => (value > 0n ? value : 0n);

/** Rows read per page while exporting. */
const EXPORT_PAGE = 200;

/**
 * The read side of payments (feature 5, screens 2–5): Transactions and its export, the KPI cards
 * and aging, the Outstanding list, a patient's account (balance card, history with Remaining),
 * receipts and statements. Every method requires `payment:read`; patient reads re-check
 * `patient:read`, visit numbers `visit:read` (every role holds both).
 */
@Injectable()
export class PaymentViewsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly tenancy: TenancyService,
    private readonly patients: PatientsService,
    private readonly contacts: ContactsService,
    private readonly users: UsersService,
    private readonly visits: VisitsService,
    private readonly paymentsService: PaymentsService,
    private readonly payments: PaymentsRepository,
    private readonly allocations: AllocationsRepository,
    private readonly entries: LedgerEntriesRepository,
    private readonly labels: ChargeLabels,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `GET /billing/payments`: newest first by (paid date, id), cursor-paged. */
  async transactions(query: TransactionQuery): Promise<TransactionPage> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () => {
      const tenant = await this.tenancy.currentTenant();
      const criteria = await this.criteriaFor(query, this.today(tenant));
      const after = query.cursor ? decodeDateIdCursor(query.cursor) : undefined;
      const rows = await this.payments.page(criteria, after, query.limit);
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: await this.hydrate(page),
        nextCursor:
          rows.length > query.limit && last
            ? encodeDateIdCursor({ date: last.paidAt, id: last.id })
            : null,
      };
    });
  }

  /** The Transactions view as CSV, read a page at a time as the chunks are pulled. */
  async exportTransactions(
    query: TransactionExportQuery,
    labels: TransactionExportLabels,
  ): Promise<{ fileName: string; chunks: AsyncGenerator<string> }> {
    this.context.requirePermission('payment:read');
    const tenant = await this.tenancy.currentTenant();
    const today = this.today(tenant);
    const criteria = await this.tenantDb.run(() => this.criteriaFor(query, today));
    return {
      fileName: `payments-${today}.csv`,
      chunks: this.exportChunks(criteria, labels),
    };
  }

  /** `GET /billing/aging`: KPI cards and aging buckets, in the tenant currency (P13, P14). */
  async receivables(): Promise<Receivables> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () => {
      const tenant = await this.tenancy.currentTenant();
      const today = this.today(tenant);
      const remainders = (await this.allocations.openTargets(tenant.currency)).map((target) => ({
        patientId: target.patientId,
        date: target.date,
        amount: max0(target.net) - target.allocated,
      }));
      const kpis = await this.payments.kpis(addDays(today, -29), tenant.currency);
      return {
        currency: tenant.currency,
        collected30d: fromCents(toCents(kpis.collected)),
        refunds30d: fromCents(toCents(kpis.refunds)),
        outstanding: fromCents(sum(remainders.map((remainder) => remainder.amount))),
        buckets: agingTotals(remainders, today).map((bucket) => ({
          ...bucket,
          amount: fromCents(bucket.amount),
        })),
      };
    });
  }

  /**
   * `GET /billing/outstanding`: owing patients — or, with `group=payer`, owing families — oldest
   * unpaid first; a bucket filter on that oldest charge (P13). A family is everyone whose primary
   * billing contact is the same contact, with that contact's own record when they are a patient
   * who owes; a patient without a billing contact is their own group.
   */
  async outstanding(query: OutstandingQuery): Promise<OutstandingPage> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () => {
      const tenant = await this.tenancy.currentTenant();
      const today = this.today(tenant);
      const byPatient = new Map<string, { oldest: string; visits: Set<string>; owed: bigint }>();
      for (const target of await this.allocations.openTargets(tenant.currency)) {
        const row = byPatient.get(target.patientId) ?? {
          oldest: target.date,
          visits: new Set<string>(),
          owed: 0n,
        };
        if (target.date < row.oldest) row.oldest = target.date;
        if (target.visitId) row.visits.add(target.visitId);
        row.owed += max0(target.net) - target.allocated;
        byPatient.set(target.patientId, row);
      }
      const owing = [...byPatient].filter(([, row]) => row.owed > 0n);
      const billing = new Map(
        (await this.contacts.primaryBillingContacts(owing.map(([id]) => id))).map((row) => [
          row.patientId,
          row.contact,
        ]),
      );
      const payerContacts = new Map([...billing.values()].map((contact) => [contact.id, contact]));
      // A parent who is a patient joins the family they pay for, unless someone else bills them.
      const familyOf = (patientId: string): string => {
        const own = billing.get(patientId);
        if (own) return own.id;
        const asPayer = [...payerContacts.values()].find(
          (contact) => contact.linkedPatient?.id === patientId,
        );
        return asPayer?.id ?? patientId;
      };

      interface Group {
        key: string;
        payer: Payer | null;
        members: { id: string; oldest: string }[];
        payFor: string;
        oldest: string;
        visits: number;
        owed: bigint;
      }
      const groups = new Map<string, Group>();
      for (const [patientId, row] of owing) {
        const key = query.group === 'payer' ? familyOf(patientId) : patientId;
        const contact = query.group === 'payer' ? payerContacts.get(key) : billing.get(patientId);
        const group = groups.get(key) ?? {
          key,
          payer: contact ? this.payerOfContact(contact) : null,
          members: [],
          payFor: patientId,
          oldest: row.oldest,
          visits: 0,
          owed: 0n,
        };
        group.members.push({ id: patientId, oldest: row.oldest });
        if (row.oldest < group.oldest) group.oldest = row.oldest;
        group.visits += row.visits.size;
        group.owed += row.owed;
        // Open the panel with a member the payer bills, so a household payment covers them all.
        if (billing.get(patientId)?.id === key) group.payFor = patientId;
        groups.set(key, group);
      }

      const matching = query.q ? new Set(await this.patientIdsMatching(query.q)) : undefined;
      const after = query.cursor ? decodeDateIdCursor(query.cursor) : undefined;
      const rows = [...groups.values()]
        .map((group) => ({ ...group, bucket: agingBucket(group.oldest, today) }))
        .filter((group) => !query.bucket || group.bucket === query.bucket)
        .filter((group) => !matching || group.members.some((member) => matching.has(member.id)))
        .sort((a, b) =>
          a.oldest !== b.oldest ? (a.oldest < b.oldest ? -1 : 1) : a.key < b.key ? -1 : 1,
        )
        .filter(
          (group) =>
            !after ||
            group.oldest > after.date ||
            (group.oldest === after.date && group.key > after.id),
        );
      const page = rows.slice(0, query.limit);
      const refs = await this.patientRefs(page.flatMap((group) => group.members.map((m) => m.id)));
      const ref = (id: string) => refs.get(id) ?? this.unknownPatient(id);
      const last = page.at(-1);
      return {
        items: page.map((group) => {
          const members = [...group.members].sort((a, b) => (a.oldest < b.oldest ? -1 : 1));
          return {
            patient: ref(members[0]?.id ?? group.payFor),
            payer: group.payer,
            members: members.map((member) => ref(member.id)),
            payFor: group.payFor,
            oldestUnpaid: group.oldest,
            bucket: group.bucket,
            openVisits: group.visits,
            balance: fromCents(group.owed),
            currency: tenant.currency,
          };
        }),
        nextCursor:
          rows.length > query.limit && last
            ? encodeDateIdCursor({ date: last.oldest, id: last.key })
            : null,
      };
    });
  }

  /**
   * `GET /billing/contacts/:id/family`: what a billing contact's family owes — the household of
   * ADR-0028 seen from the payer (their own record, if a patient, and everyone they bill for).
   */
  async family(contactId: string): Promise<Family> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () => {
      const payer = this.payerOfContact(await this.contacts.contactView(contactId));
      const billed = (await this.contacts.patientsBilledBy(contactId)).filter(
        (patient) => patient.archivedAt === null,
      );
      const ids = [
        ...new Set([
          ...(payer.patientId ? [payer.patientId] : []),
          ...billed.map((patient) => patient.id),
        ]),
      ];
      const { currency } = await this.tenancy.currentTenant();
      const refs = await this.patientRefs(ids);
      const sums = await this.entries.sumsByPatient(ids);
      const targets = (await this.allocations.targetsOf(ids)).filter(
        (target) => target.currency === currency,
      );
      const owed = outstandingByTarget(targets, await this.allocations.pairsOf(ids));
      const members = ids.flatMap((id) => {
        const patient = refs.get(id);
        if (!patient) return [];
        const open = targets.filter(
          (target) => target.patientId === id && (owed.get(target.entryId) ?? 0n) > 0n,
        );
        const balance = toCents(
          sums.find((row) => row.patientId === id && row.currency === currency)?.amount ?? '0',
        );
        return [
          {
            ...patient,
            balance: fromCents(balance),
            oldestUnpaid: open.map((target) => target.date).sort()[0] ?? null,
            openVisits: new Set(open.flatMap((target) => target.visitId ?? [])).size,
            isPayer: id === payer.patientId,
          },
        ];
      });
      return {
        payer,
        currency,
        members,
        total: fromCents(sum(members.map((member) => max0(toCents(member.balance))))),
        payFor: billed[0]?.id ?? null,
      };
    });
  }

  /** `GET /billing/contacts/:id/family/statement`: each member's statement, and the total. */
  async familyStatement(contactId: string): Promise<FamilyStatement> {
    const family = await this.family(contactId);
    const members: Statement[] = [];
    for (const member of family.members) members.push(await this.statement(member.id));
    return {
      payer: family.payer,
      currency: family.currency,
      members,
      total: family.total,
    };
  }

  /**
   * `GET /billing/patients/:id/account`: the Balance & payments tab and the payment panel —
   * with `payerContactId`, the payer (and household) the panel opens with instead of the default.
   */
  async account(patientId: string, payerContactId?: string): Promise<PatientAccount> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () => {
      const [patient] = await this.patients.getMany([patientId]);
      if (!patient) throw new PatientNotFoundError('Patient not found');
      const { currency } = await this.tenancy.currentTenant();
      const inCurrency = <T extends { currency: string }>(rows: T[]) =>
        rows.filter((row) => row.currency === currency);
      const targets = inCurrency(await this.allocations.targetsOf([patientId]));
      const sources = inCurrency(await this.allocations.sourcesOf([patientId]));
      const pairs = await this.allocations.pairsOf([patientId]);
      const owed = outstandingByTarget(targets, pairs);
      const credit = sum(unallocatedBySource(sources, pairs).values());
      const numbers = await this.labels.visitNumbers(targets.map((target) => target.visitId));

      const openCharges: OpenCharge[] = targets
        .filter((target) => (owed.get(target.entryId) ?? 0n) > 0n)
        .sort(byAge)
        .map((target) => this.openCharge(target, owed, numbers));
      const last = targets
        .filter((target) => target.visitId !== null && target.net > 0n)
        .sort(byAge)
        .at(-1);
      const totalOwed = sum(owed.values());
      const lastOwed = last ? (owed.get(last.entryId) ?? 0n) : 0n;
      const balance = await this.balanceIn(patientId, currency);

      const payers = await this.payersOf(patientId);
      const payer = await this.paymentsService.resolvePayer(patientId, payerContactId);
      const own = await this.contacts.contactOfPatient(patientId);
      const billsOthers =
        own !== null &&
        (await this.contacts.patientsBilledBy(own.id)).some((billed) => billed.archivedAt === null);
      return {
        patientId,
        currency,
        balance: fromCents(balance),
        credit: fromCents(credit),
        lastVisit:
          last && last.visitId
            ? {
                visitId: last.visitId,
                visitNumber: numbers.get(last.visitId) ?? 0,
                date: last.date,
                total: fromCents(last.net),
                paid: fromCents(last.allocated),
                outstanding: fromCents(lastOwed),
              }
            : null,
        previousOutstanding: fromCents(totalOwed - lastOwed),
        openCharges,
        payer: this.payerView(payer, patient.fullName),
        payers,
        household: await this.household(patientId, payer, currency),
        payerFor: own && billsOthers ? this.payerOfContact(own) : null,
        history: await this.history(patientId),
        adjustments: await this.adjustments(patientId, currency),
      };
    });
  }

  /** `GET /billing/payments/:id/receipt`: a payment's receipt (its household rows too). */
  async receipt(paymentId: string): Promise<Receipt> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () => {
      const found = await this.payments.findById(paymentId);
      const payment =
        found?.reversesPaymentId != null
          ? await this.payments.findById(found.reversesPaymentId)
          : found;
      if (!payment) throw new PaymentNotFoundError('Payment not found');
      const rows = payment.householdGroupId
        ? await this.payments.receiptRows(payment.receiptNumber)
        : [payment];
      const reversals = await this.payments.reversalsOf(rows.map((row) => row.id));
      const lines = await this.allocations.linesOfSources(
        rows.map((row) => row.ledgerEntryId),
        true,
      );
      const labelled = await this.labels.label(lines);
      const refs = await this.patientRefs(rows.map((row) => row.patientId));
      const names = await this.users.namesByUserIds([payment.recordedBy]);
      const voided = reversals.find((row) => row.kind === 'void');
      return {
        receiptNumber: payment.receiptNumber,
        paidAt: payment.paidAt,
        method: payment.method,
        reference: payment.reference,
        currency: payment.currency,
        total: fromCents(sum(rows.map((row) => toCents(row.amount)))),
        voided: voided ? { on: voided.paidAt, reason: voided.reason ?? '' } : null,
        refunds: reversals
          .filter((row) => row.kind === 'refund')
          .map((row) => ({
            on: row.paidAt,
            amount: fromCents(toCents(row.amount)),
            reason: row.reason ?? '',
          })),
        payer: await this.payerOfPayment(payment, refs),
        recordedBy: names.get(payment.recordedBy) ?? null,
        rows: rows.map((row) => ({
          paymentId: row.id,
          patient: refs.get(row.patientId) ?? this.unknownPatient(row.patientId),
          amount: fromCents(toCents(row.amount)),
          allocations: labelled.filter((_, index) => lines[index]?.sourceId === row.ledgerEntryId),
          balanceAfter: fromCents(toCents(row.balanceAfter ?? '0')),
        })),
      };
    });
  }

  /** `GET /billing/patients/:id/statement`: every entry, oldest first, with the running balance. */
  async statement(patientId: string): Promise<Statement> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () => {
      const [patient] = await this.patients.getMany([patientId]);
      if (!patient) throw new PatientNotFoundError('Patient not found');
      const { currency } = await this.tenancy.currentTenant();
      const entries = (await this.entries.listForPatient(patientId)).filter(
        (entry) => entry.currency === currency,
      );
      const rows = await this.payments.forPatient(patientId);
      const byEntry = new Map(rows.map((row) => [row.ledgerEntryId, row]));
      const voidedIds = this.voidedPaymentIds(rows);
      const numbers = await this.labels.visitNumbers(entries.map((entry) => entry.visitId));
      const lines = runningBalance(
        entries.map((entry) => {
          const payment = byEntry.get(entry.id);
          const voided =
            entry.kind === 'payment_void' || (payment !== undefined && voidedIds.has(payment.id));
          return {
            ...entry,
            amount: toCents(entry.amount),
            date: entry.effectiveDate,
            createdAt: entry.createdAt.getTime(),
            voided,
            payment,
          };
        }),
      ).filter((line) => !line.entry.voided);
      const isPayment = (kind: LedgerEntryKind) => kind === 'payment' || kind === 'payment_refund';
      const charged = sum(
        lines.filter((line) => !isPayment(line.entry.kind)).map((line) => line.entry.amount),
      );
      const paid = -sum(
        lines.filter((line) => isPayment(line.entry.kind)).map((line) => line.entry.amount),
      );
      const payer = await this.paymentsService.resolvePayer(patientId, undefined);
      return {
        patient: {
          id: patient.id,
          fullName: patient.fullName,
          displayNumber: patient.displayNumber,
        },
        billingContact: payer.contactId ? this.payerView(payer, patient.fullName) : null,
        currency,
        lines: lines.map(({ entry, balance }) => ({
          date: entry.date,
          kind: STATEMENT_KIND[entry.kind],
          visitNumber: entry.visitId ? (numbers.get(entry.visitId) ?? null) : null,
          receiptNumber: entry.payment?.receiptNumber ?? null,
          method: entry.payment?.method ?? null,
          reason: entry.kind === 'adjustment' ? entry.reason : null,
          // An adjustment's reason has its own field; elsewhere it stands in for a missing note.
          note: entry.kind === 'adjustment' ? entry.note : (entry.note ?? entry.reason),
          amount: fromCents(entry.amount),
          balance: fromCents(balance),
        })),
        charged: fromCents(charged),
        paid: fromCents(paid),
        outstanding: fromCents(lines.at(-1)?.balance ?? 0n),
      };
    });
  }

  // --- Building blocks ---

  /**
   * The account's balance right after each ledger entry (the history's Remaining), by entry id;
   * a voided payment and its void add nothing (P7).
   */
  private async remainingByEntry(patientId: string): Promise<Map<string, bigint>> {
    const rows = await this.payments.forPatient(patientId);
    const voidedIds = this.voidedPaymentIds(rows);
    const paymentOf = new Map(rows.map((row) => [row.ledgerEntryId, row]));
    const entries = await this.entries.listForPatient(patientId);
    return new Map(
      runningBalance(
        entries.map((entry) => {
          const payment = paymentOf.get(entry.id);
          return {
            id: entry.id,
            kind: entry.kind,
            amount: toCents(entry.amount),
            date: entry.effectiveDate,
            createdAt: entry.createdAt.getTime(),
            voided:
              entry.kind === 'payment_void' || (payment !== undefined && voidedIds.has(payment.id)),
          };
        }),
      ).map((line) => [line.entry.id, line.balance]),
    );
  }

  /** The account's balance adjustments in `currency`, newest first, each with its Remaining (H4). */
  private async adjustments(patientId: string, currency: string): Promise<AccountAdjustment[]> {
    const entries = (await this.entries.listForPatient(patientId)).filter(
      (entry) => entry.kind === 'adjustment' && entry.currency === currency,
    );
    if (entries.length === 0) return [];
    const remaining = await this.remainingByEntry(patientId);
    const names = await this.users.namesByUserIds(entries.map((entry) => entry.createdBy));
    return entries
      .map((entry) => ({
        id: entry.id,
        date: entry.effectiveDate,
        amount: fromCents(toCents(entry.amount)),
        currency: entry.currency,
        reason: entry.reason,
        note: entry.note,
        recordedBy: names.get(entry.createdBy) ?? null,
        recordedAt: entry.createdAt.toISOString(),
        remaining: fromCents(remaining.get(entry.id) ?? 0n),
      }))
      .reverse();
  }

  /** A patient's payments and refunds, newest first, with allocations and the running Remaining. */
  private async history(patientId: string): Promise<PaymentHistoryItem[]> {
    const rows = (await this.payments.forPatient(patientId)).filter((row) => row.kind !== 'void');
    if (rows.length === 0) return [];
    const remaining = await this.remainingByEntry(patientId);
    const transactions = await this.hydrate(rows);
    const lines = await this.allocations.linesOfSources(rows.map((row) => row.ledgerEntryId));
    const labelled = await this.labels.label(lines);
    return transactions
      .map((transaction, index) => {
        const row = rows[index];
        const own: AllocationLine[] = labelled.filter(
          (_, i) => lines[i]?.sourceId === row?.ledgerEntryId,
        );
        return {
          ...transaction,
          allocations: own,
          remaining: fromCents(remaining.get(row?.ledgerEntryId ?? '') ?? 0n),
        };
      })
      .sort((a, b) =>
        a.paidAt !== b.paidAt ? (a.paidAt < b.paidAt ? 1 : -1) : a.id < b.id ? 1 : -1,
      );
  }

  /** Transactions rows with their patient, refunds, visits and recorder. */
  private async hydrate(rows: readonly Payment[]): Promise<Transaction[]> {
    if (rows.length === 0) return [];
    const refs = await this.patientRefs(rows.map((row) => row.patientId));
    const names = await this.users.namesByUserIds(rows.map((row) => row.recordedBy));
    const paymentRows = rows.filter((row) => row.kind === 'payment');
    const reversals = await this.payments.reversalsOf(paymentRows.map((row) => row.id));
    const lines = await this.allocations.linesOfSources(
      paymentRows.map((row) => row.ledgerEntryId),
    );
    const numbers = await this.labels.visitNumbers(lines.map((line) => line.visitId));
    return rows.map((row) => {
      const own = reversals.filter((reversal) => reversal.reversesPaymentId === row.id);
      const visitIds = [
        ...new Set(
          lines
            .filter((line) => line.sourceId === row.ledgerEntryId && line.visitId !== null)
            .map((line) => line.visitId as string),
        ),
      ];
      return {
        id: row.id,
        kind: row.kind,
        receiptNumber: row.receiptNumber,
        paidAt: row.paidAt,
        patient: refs.get(row.patientId) ?? this.unknownPatient(row.patientId),
        householdGroupId: row.householdGroupId,
        method: row.method,
        amount: fromCents(toCents(row.amount)),
        currency: row.currency,
        reference: row.reference,
        note: row.note,
        reason: row.reason,
        reversesPaymentId: row.reversesPaymentId,
        partial: row.kind === 'payment' && toCents(row.balanceAfter ?? '0') > 0n,
        refunded: fromCents(
          sum(own.filter((r) => r.kind === 'refund').map((r) => toCents(r.amount))),
        ),
        voided: own.some((reversal) => reversal.kind === 'void'),
        visits: visitIds.map((visitId) => ({ visitId, visitNumber: numbers.get(visitId) ?? 0 })),
        recordedBy: { userId: row.recordedBy, name: names.get(row.recordedBy) ?? null },
        recordedAt: row.createdAt.toISOString(),
      };
    });
  }

  private async *exportChunks(
    criteria: TransactionCriteria,
    labels: TransactionExportLabels,
  ): AsyncGenerator<string> {
    let head =
      UTF8_BOM +
      csvRow([
        labels.date,
        labels.receipt,
        labels.patient,
        labels.patientId,
        labels.type,
        labels.method,
        labels.visits,
        labels.recordedBy,
        labels.amount,
        labels.reference,
        labels.reason,
      ]);
    let after: { date: string; id: string } | undefined;
    for (;;) {
      const rows = await this.tenantDb.run(() => this.payments.page(criteria, after, EXPORT_PAGE));
      const page = rows.slice(0, EXPORT_PAGE);
      const items = await this.tenantDb.run(() => this.hydrate(page));
      const lines = items.map((item) =>
        csvRow(
          [
            item.paidAt,
            formatReceiptNumber(item.receiptNumber),
            item.patient.fullName,
            item.patient.displayNumber,
            labels.kinds[item.kind],
            labels.methods[item.method],
            item.visits.map((visit) => formatVisitNumber(visit.visitNumber)).join('; '),
            item.recordedBy.name ?? '',
            item.kind === 'payment' ? item.amount : `-${item.amount}`,
            item.reference ?? '',
            item.reason ?? '',
          ],
          { numericColumns: [8] },
        ),
      );
      if (lines.length > 0) {
        yield head + lines.join('');
        head = '';
      }
      const last = page.at(-1);
      if (rows.length <= EXPORT_PAGE || !last) break;
      after = { date: last.paidAt, id: last.id };
    }
    if (head) yield head;
  }

  /** The filters as repository criteria; `q` matches a patient, a receipt or a visit number. */
  private async criteriaFor(
    filters: TransactionFilters,
    today: string,
  ): Promise<TransactionCriteria> {
    const range = filters.range;
    const criteria: TransactionCriteria = {
      ...(range === 'all' ? {} : { from: addDays(today, 1 - RANGE_DAYS[range]) }),
      ...(filters.method ? { method: filters.method } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.patientId ? { patientId: filters.patientId } : {}),
    };
    const q = filters.q?.trim();
    if (!q) return criteria;
    const receipt = /^(?:rct-?)?0*(\d{1,9})$/i.exec(q);
    const visitNumber = /^v-?0*(\d{1,9})$/i.exec(q)?.[1];
    const visit = visitNumber !== undefined;
    // The visits search matches numbers loosely; a receipt search wants that visit only.
    const visitIds = visit
      ? (await this.visits.search({ tab: 'all', range: 'all', q, limit: 100 })).items
          .filter((item) => item.displayNumber === Number(visitNumber))
          .map((item) => item.id)
      : [];
    return {
      ...criteria,
      match: {
        patientIds: visit ? [] : await this.patientIdsMatching(q),
        ...(receipt?.[1] ? { receiptNumber: Number(receipt[1]) } : {}),
        paymentIds: await this.allocations.paymentIdsForVisits(visitIds),
      },
    };
  }

  private patientIdsMatching(q: string): Promise<string[]> {
    const { page: _page, size: _size, ...query } = patientListQuerySchema.parse({ q });
    return this.patients.searchIds(query);
  }

  private async patientRefs(ids: readonly string[]): Promise<Map<string, PatientRef>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    return new Map(
      (await this.patients.getMany(unique)).map((patient) => [
        patient.id,
        { id: patient.id, fullName: patient.fullName, displayNumber: patient.displayNumber },
      ]),
    );
  }

  private unknownPatient(id: string): PatientRef {
    return { id, fullName: '', displayNumber: '' };
  }

  /** The patient's possible payers: themself, then each billing contact. */
  private async payersOf(patientId: string): Promise<Payer[]> {
    const links = (await this.contacts.contactsOf(patientId)).filter(
      (link) => link.isBillingContact,
    );
    return links.map((link) => ({
      contactId: link.contact.id,
      name: link.contact.fullName,
      patientId:
        link.contact.linkedPatient && !link.contact.linkedPatient.archived
          ? link.contact.linkedPatient.id
          : null,
    }));
  }

  private payerOfContact(contact: ContactView): Payer {
    return {
      contactId: contact.id,
      name: contact.fullName,
      patientId:
        contact.linkedPatient && !contact.linkedPatient.archived ? contact.linkedPatient.id : null,
    };
  }

  private payerView(
    payer: { contactId: string | null; name: string | null; patientId: string | null },
    patientName: string,
  ): Payer {
    return {
      contactId: payer.contactId,
      name: payer.contactId ? (payer.name ?? '') : patientName,
      patientId: payer.patientId,
    };
  }

  private async payerOfPayment(payment: Payment, refs: Map<string, PatientRef>): Promise<Payer> {
    const patientName = refs.get(payment.patientId)?.fullName ?? '';
    if (!payment.payerContactId) return { contactId: null, name: patientName, patientId: null };
    const link = (await this.contacts.contactsOf(payment.patientId)).find(
      (candidate) => candidate.contact.id === payment.payerContactId,
    );
    return {
      contactId: payment.payerContactId,
      name: link?.contact.fullName ?? '',
      patientId: link?.contact.linkedPatient?.id ?? null,
    };
  }

  /** B5: the default payer's household, when it holds more than this one account. */
  private async household(
    patientId: string,
    payer: Awaited<ReturnType<PaymentsService['resolvePayer']>>,
    currency: string,
  ): Promise<PatientAccount['household']> {
    if (!payer.contactId) return null;
    const ids = await this.paymentsService.householdIds(patientId, payer);
    if (ids.length < 2) return null;
    const refs = await this.patientRefs(ids);
    const sums = await this.entries.sumsByPatient(ids);
    const balanceOf = (id: string) =>
      toCents(sums.find((row) => row.patientId === id && row.currency === currency)?.amount ?? '0');
    return {
      payer: this.payerView(payer, ''),
      patients: ids.flatMap((id) => {
        const ref = refs.get(id);
        return ref ? [{ ...ref, balance: fromCents(balanceOf(id)) }] : [];
      }),
      total: fromCents(sum(ids.map((id) => max0(balanceOf(id))))),
    };
  }

  private openCharge(
    target: AccountTarget,
    owed: Map<string, bigint>,
    numbers: Map<string, number>,
  ): OpenCharge {
    return {
      entryId: target.entryId,
      patientId: target.patientId,
      kind: target.kind,
      visitId: target.visitId,
      visitNumber: target.visitId ? (numbers.get(target.visitId) ?? null) : null,
      date: target.date,
      charged: fromCents(target.net),
      paid: fromCents(target.allocated),
      outstanding: fromCents(owed.get(target.entryId) ?? 0n),
    };
  }

  private voidedPaymentIds(rows: readonly Payment[]): Set<string> {
    return new Set(
      rows
        .filter((row) => row.kind === 'void' && row.reversesPaymentId)
        .map((row) => row.reversesPaymentId as string),
    );
  }

  private async balanceIn(patientId: string, currency: string): Promise<bigint> {
    const sums = await this.entries.sumsByPatient([patientId]);
    return toCents(sums.find((row) => row.currency === currency)?.amount ?? '0');
  }

  private today(tenant: Tenant): string {
    return localDate(this.clock.now(), tenant.timeZone);
  }
}

const STATEMENT_KIND: Record<LedgerEntryKind, Statement['lines'][number]['kind']> = {
  opening_balance: 'opening_balance',
  adjustment: 'adjustment',
  visit_charge: 'charge',
  visit_charge_adjustment: 'charge_correction',
  visit_charge_reversal: 'charge_correction',
  payment: 'payment',
  payment_refund: 'refund',
  payment_void: 'payment',
};
