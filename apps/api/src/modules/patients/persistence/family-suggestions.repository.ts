import { Injectable } from '@nestjs/common';
import { and, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { newId } from '../../../platform/kernel/id';
import type { FamilyPerson } from '../domain/family-suggestions';
import { idAmong } from './patient-search.sql';
import { contacts, familyDismissals, patientContacts, patients } from './schema';

/** A person of a possible family, with what the review card shows. */
export type FamilyPersonRow = FamilyPerson & {
  fullName: string;
  /** As stored (`storedPhone`). */
  phone: string;
  /** Patients only. */
  displayNumber: string | null;
  dateOfBirth: string | null;
};

/** The digits of a stored phone: the first word of `phone_search` (ADR-0052, ADR-0093). */
const patientKey = sql<string>`split_part(${patients.phoneSearch}, ' ', 1)`;
const contactKey = sql<string>`split_part(${contacts.phoneSearch}, ' ', 1)`;

/** The phone keys at least two people share: active patients and contacts who are no patient. */
const sharedKeys = sql`(
  select k from (
    select ${patientKey} as k from ${patients}
    where ${patients.deletedAt} is null and ${patients.phoneSearch} is not null
    union all
    select ${contactKey} as k from ${contacts}
    where ${contacts.deletedAt} is null and ${contacts.linkedPatientId} is null
      and ${contacts.phoneSearch} is not null
  ) keys group by k having count(*) >= 2
)`;

/**
 * The reads and the one write behind possible families (families B, ADR-0093). Every query runs
 * through `TenantDb`: RLS keeps them to the tenant.
 */
@Injectable()
export class FamilySuggestionsRepository {
  constructor(private readonly db: TenantDb) {}

  /** Everyone whose phone key someone else has too. */
  async sharedPhonePeople(): Promise<FamilyPersonRow[]> {
    return this.db.run(async (tx) => {
      const patientRows = await tx
        .select({
          id: patients.id,
          fullName: patients.fullName,
          nameKey: patients.nameKey,
          phone: patients.phone,
          phoneKey: patientKey,
          displayNumber: patients.displayNumber,
          dateOfBirth: patients.dateOfBirth,
        })
        .from(patients)
        .where(
          and(
            isNull(patients.deletedAt),
            isNotNull(patients.phoneSearch),
            sql`${patientKey} in ${sharedKeys}`,
          ),
        );
      const contactRows = await tx
        .select({
          id: contacts.id,
          fullName: contacts.fullName,
          nameKey: contacts.nameKey,
          phone: contacts.phone,
          phoneKey: contactKey,
        })
        .from(contacts)
        .where(
          and(
            isNull(contacts.deletedAt),
            isNull(contacts.linkedPatientId),
            isNotNull(contacts.phoneSearch),
            sql`${contactKey} in ${sharedKeys}`,
          ),
        );
      return [
        ...patientRows.map((row) => ({
          kind: 'patient' as const,
          id: row.id,
          fullName: row.fullName,
          nameKey: row.nameKey,
          phone: row.phone ?? '',
          phoneKey: row.phoneKey,
          displayNumber: row.displayNumber,
          dateOfBirth: row.dateOfBirth,
        })),
        ...contactRows.map((row) => ({
          kind: 'contact' as const,
          id: row.id,
          fullName: row.fullName ?? '',
          nameKey: row.nameKey ?? '',
          phone: row.phone ?? '',
          phoneKey: row.phoneKey,
          displayNumber: null,
          dateOfBirth: null,
        })),
      ];
    });
  }

  /** The live contacts that are these patients: contact id → patient id. */
  async contactsOfPatients(patientIds: readonly string[]): Promise<Map<string, string>> {
    if (patientIds.length === 0) return new Map();
    const rows = await this.db.run((tx) =>
      tx
        .select({ id: contacts.id, patientId: contacts.linkedPatientId })
        .from(contacts)
        .where(and(isNull(contacts.deletedAt), idAmong(contacts.linkedPatientId, patientIds))),
    );
    return new Map(rows.flatMap((row) => (row.patientId ? [[row.id, row.patientId]] : [])));
  }

  /** Every link of these patients, and every link to these contacts. */
  async linksTouching(
    patientIds: readonly string[],
    contactIds: readonly string[],
  ): Promise<{ patientId: string; contactId: string }[]> {
    if (patientIds.length === 0 && contactIds.length === 0) return [];
    return this.db.run((tx) =>
      tx
        .select({ patientId: patientContacts.patientId, contactId: patientContacts.contactId })
        .from(patientContacts)
        .where(
          or(
            idAmong(patientContacts.patientId, patientIds),
            idAmong(patientContacts.contactId, contactIds),
          ),
        ),
    );
  }

  /** The "Not a family" answers: phone key → the people answered for. */
  async dismissals(): Promise<Map<string, Set<string>>> {
    const rows = await this.db.run((tx) =>
      tx
        .select({ phoneKey: familyDismissals.phoneKey, people: familyDismissals.people })
        .from(familyDismissals),
    );
    return new Map(rows.map((row) => [row.phoneKey, new Set(row.people)]));
  }

  /** Records "Not a family" for `people` sharing `phoneKey`, replacing an earlier answer. */
  async saveDismissal(phoneKey: string, people: readonly string[], by: string): Promise<string> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .insert(familyDismissals)
        .values({ id: newId(), phoneKey, people: [...people], dismissedBy: by })
        .onConflictDoUpdate({
          target: [familyDismissals.tenantId, familyDismissals.phoneKey],
          set: { people: [...people], dismissedBy: by, updatedAt: sql`now()` },
        })
        .returning({ id: familyDismissals.id });
      if (!row) throw new Error('saveDismissal returned no row');
      return row.id;
    });
  }
}
