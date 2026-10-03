import { VISIT_LEDGER_KINDS } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import type {
  LedgerEntry,
  LedgerEntryLine,
  PatientCurrencySum,
  VisitSum,
} from '../domain/ledger-entry';
import { ledgerEntries, ledgerEntryLines } from './schema';

type LedgerEntryRow = typeof ledgerEntries.$inferSelect;

export type NewLedgerEntry = Omit<LedgerEntry, 'id' | 'createdAt' | 'updatedAt'>;

function toDomain(row: LedgerEntryRow): LedgerEntry {
  return {
    id: row.id,
    patientId: row.patientId,
    kind: row.kind,
    amount: row.amount,
    currency: row.currency,
    effectiveDate: row.effectiveDate,
    note: row.note,
    reason: row.reason,
    createdBy: row.createdBy,
    visitId: row.visitId,
    amendmentId: row.amendmentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The tenant's `ledger_entries` (RLS-scoped through `TenantDb`; `tenant_id` is never passed —
 * CLAUDE.md §5). Entries are never edited or deleted; the one update is `repointPatient`, which
 * only the merge job calls (design Q9).
 */
@Injectable()
export class LedgerEntriesRepository {
  constructor(private readonly db: TenantDb) {}

  async insert(entry: NewLedgerEntry): Promise<LedgerEntry> {
    const [row] = await this.db.run((tx) => tx.insert(ledgerEntries).values(entry).returning());
    if (!row) throw new Error('ledger entry insert returned no row');
    return toDomain(row);
  }

  /** The lines of a `visit_charge` entry just inserted in this transaction (spec V7). */
  async insertLines(entryId: string, lines: readonly LedgerEntryLine[]): Promise<void> {
    if (lines.length === 0) return;
    await this.db.run((tx) =>
      tx.insert(ledgerEntryLines).values(lines.map((line) => ({ entryId, ...line }))),
    );
  }

  /**
   * Serialises allocation on one account (feature 5, P4): a transaction-scoped advisory lock, so
   * two payments, or a payment and a visit change, settle the same patient one after the other.
   * Taken after the patient's `FOR SHARE` lock, in patient id order when several are locked.
   */
  async lockAccount(patientId: string): Promise<void> {
    await this.db.run((tx) =>
      tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`account:${patientId}`}, 0))`),
    );
  }

  /** Every entry of `patientId`, oldest first (the statement, the running Remaining). */
  async listForPatient(patientId: string): Promise<LedgerEntry[]> {
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.patientId, patientId))
        .orderBy(ledgerEntries.effectiveDate, ledgerEntries.createdAt, ledgerEntries.id),
    );
    return rows.map(toDomain);
  }

  /** Every entry about `visitId` (charge, adjustments, reversal), oldest first. */
  async listForVisit(visitId: string): Promise<LedgerEntry[]> {
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.visitId, visitId))
        .orderBy(ledgerEntries.createdAt, ledgerEntries.id),
    );
    return rows.map(toDomain);
  }

  /** Σ amount per visit and currency over the visit entries of `visitIds`; visits without entries
   * are absent. */
  async sumsByVisit(visitIds: readonly string[]): Promise<VisitSum[]> {
    if (visitIds.length === 0) return [];
    return this.db.run(async (tx) => {
      const rows = await tx
        .select({
          visitId: ledgerEntries.visitId,
          currency: ledgerEntries.currency,
          amount: sql<string>`sum(${ledgerEntries.amount})::text`,
        })
        .from(ledgerEntries)
        .where(inArray(ledgerEntries.visitId, [...visitIds]))
        .groupBy(ledgerEntries.visitId, ledgerEntries.currency)
        .orderBy(ledgerEntries.visitId, ledgerEntries.currency);
      return rows.flatMap(({ visitId, ...sum }) => (visitId === null ? [] : [{ visitId, ...sum }]));
    });
  }

  /**
   * Σ amount per patient and currency, summed by Postgres on `numeric` (exact), as decimal
   * strings, for the patients among `patientIds`, with `charged` = Σ amount over the visit
   * entries alone — charges, adjustments, reversals (`0` when there is none). Patients without entries are absent;
   * zero sums are included. Ordered by patient, then currency.
   */
  async sumsByPatient(patientIds: readonly string[]): Promise<PatientCurrencySum[]> {
    if (patientIds.length === 0) return [];
    const among = sql`${ledgerEntries.patientId} = any(${sql.param([...patientIds])}::uuid[])`;
    return this.db.run((tx) =>
      tx
        .select({
          patientId: ledgerEntries.patientId,
          currency: ledgerEntries.currency,
          amount: sql<string>`sum(${ledgerEntries.amount})::text`,
          charged: sql<string>`coalesce(sum(${ledgerEntries.amount}) filter (where ${inArray(ledgerEntries.kind, [...VISIT_LEDGER_KINDS])}), 0)::text`,
        })
        .from(ledgerEntries)
        .where(among)
        .groupBy(ledgerEntries.patientId, ledgerEntries.currency)
        .orderBy(ledgerEntries.patientId, ledgerEntries.currency),
    );
  }

  /**
   * Σ amount per patient in one currency, for every patient whose sum in it is non-zero (the
   * balance sort ranks all of them), ordered by patient id. Summed by Postgres on `numeric`.
   */
  async sumsInCurrency(currency: string): Promise<{ patientId: string; amount: string }[]> {
    return this.db.run((tx) =>
      tx
        .select({
          patientId: ledgerEntries.patientId,
          amount: sql<string>`sum(${ledgerEntries.amount})::text`,
        })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.currency, currency))
        .groupBy(ledgerEntries.patientId)
        .having(sql`sum(${ledgerEntries.amount}) <> 0`)
        .orderBy(ledgerEntries.patientId),
    );
  }

  /**
   * Moves every entry of `fromPatientId` to `toPatientId` (the merge re-point, design Q9) and
   * returns how many moved. Idempotent: a second run finds nothing left to move. Only
   * `patient_id` and `updated_at` (database clock) change; `created_by` and the amounts stay.
   */
  async repointPatient(fromPatientId: string, toPatientId: string): Promise<number> {
    const rows = await this.db.run((tx) =>
      tx
        .update(ledgerEntries)
        .set({ patientId: toPatientId, updatedAt: sql`now()` })
        .where(eq(ledgerEntries.patientId, fromPatientId))
        .returning({ id: ledgerEntries.id }),
    );
    return rows.length;
  }

  /**
   * Patients owing in any currency (design Q13: some currency's Σ amount > 0), in id order. The
   * rule is the SQL twin of summing per currency; kept in the database so the owing view never
   * transfers every balance.
   */
  async patientIdsOwing(): Promise<string[]> {
    const rows = await this.db.run((tx) =>
      tx
        .selectDistinct({ patientId: ledgerEntries.patientId })
        .from(ledgerEntries)
        .groupBy(ledgerEntries.patientId, ledgerEntries.currency)
        .having(sql`sum(${ledgerEntries.amount}) > 0`)
        .orderBy(ledgerEntries.patientId),
    );
    return rows.map((row) => row.patientId);
  }
}
