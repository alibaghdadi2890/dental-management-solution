import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { LedgerEntry, LedgerEntryLine, PatientCurrencySum } from '../domain/ledger-entry';
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

  /** The `visit_charge` of `visitId`, or undefined when none was posted (a zero total, W20). */
  async findVisitCharge(visitId: string): Promise<LedgerEntry | undefined> {
    const [row] = await this.db.run((tx) =>
      tx.select().from(ledgerEntries).where(eq(ledgerEntries.visitId, visitId)),
    );
    return row && toDomain(row);
  }

  /**
   * Σ amount per patient and currency, summed by Postgres on `numeric` (exact), as decimal
   * strings, for the patients among `patientIds`, with `charged` = Σ amount over the
   * `visit_charge` entries alone (`0` when there is none). Patients without entries are absent;
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
          charged: sql<string>`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.kind} = 'visit_charge'), 0)::text`,
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
