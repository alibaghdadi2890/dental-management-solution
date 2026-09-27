import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { LedgerEntry, PatientCurrencySum } from '../domain/ledger-entry';
import { ledgerEntries } from './schema';

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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The tenant's `ledger_entries` (RLS-scoped through `TenantDb`; `tenant_id` is never passed —
 * CLAUDE.md §5). Append-only here: nothing in this repository updates or deletes an entry.
 */
@Injectable()
export class LedgerEntriesRepository {
  constructor(private readonly db: TenantDb) {}

  async insert(entry: NewLedgerEntry): Promise<LedgerEntry> {
    const [row] = await this.db.run((tx) => tx.insert(ledgerEntries).values(entry).returning());
    if (!row) throw new Error('ledger entry insert returned no row');
    return toDomain(row);
  }

  /**
   * Σ amount per patient and currency, summed by Postgres on `numeric` (exact), as 2-decimal
   * strings, for the patients among `patientIds`. Patients without entries are absent; zero sums
   * are included. Ordered by patient, then currency.
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
        })
        .from(ledgerEntries)
        .where(among)
        .groupBy(ledgerEntries.patientId, ledgerEntries.currency)
        .orderBy(ledgerEntries.patientId, ledgerEntries.currency),
    );
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
