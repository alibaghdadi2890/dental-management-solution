import { Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { isUniqueViolation } from '../../../platform/db/unique-violation';
import { newId } from '../../../platform/kernel/id';
import { ContactConflictError } from '../domain/contact-errors';
import type { DomainContact, LinkedPatientFacts } from '../domain/contacts';
import { nameKey } from '../domain/name-key';
import {
  linkedPatients,
  resolvedNameKey,
  resolvedPhone,
  resolvedPhoneSearch,
} from './contact-resolution.sql';
import { idAmong, lookupMatch } from './patient-search.sql';
import { type NormalizedPhoneInput, phoneColumns } from './patients.repository';
import { contacts } from './schema';

type ContactRow = typeof contacts.$inferSelect;
type LinkedPatientRow = typeof linkedPatients.$inferSelect;

/** Same database clock as `patients` (see `PatientsRepository`). */
const DB_NOW = sql`now()`;

/**
 * Runs `work`, turning a race on "one live contact per linked patient" into a 409
 * (`contact.conflict`) instead of a 500.
 */
async function oneContactPerPatient<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error, 'contacts_linked_patient_unique')) {
      throw new ContactConflictError('This patient already has a contact record', {
        constraint: 'contacts_linked_patient_unique',
      });
    }
    throw error;
  }
}

export function toDomainContact(row: ContactRow): DomainContact {
  return {
    id: row.id,
    fullName: row.fullName,
    nameKey: row.nameKey,
    phone: row.phone,
    phoneSearch: row.phoneSearch,
    email: row.email,
    linkedPatientId: row.linkedPatientId,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toLinkedPatient(row: LinkedPatientRow | null): LinkedPatientFacts | null {
  if (!row) return null;
  return {
    id: row.id,
    displayNumber: row.displayNumber,
    fullName: row.fullName,
    phone: row.phone,
    email: row.email,
    deletedAt: row.deletedAt,
  };
}

/** A contact with the patient it is linked to (null when unlinked): `resolveContact`'s input. */
export interface ContactRecord {
  contact: DomainContact;
  linkedPatient: LinkedPatientFacts | null;
}

export interface NewContactRow {
  fullName: string;
  /** Already normalised against the tenant's country (as for patients). */
  phone: NormalizedPhoneInput | null;
  email: string | null;
}

/** Only the fields present change; `fullName`/`phone` rewrite `name_key`/`phone_search`. */
export interface ContactFieldsPatch {
  fullName?: string;
  phone?: NormalizedPhoneInput | null;
  email?: string | null;
}

/**
 * `contacts` of the current tenant (RLS; CLAUDE.md §5). Reads skip soft-deleted contacts and
 * return each one with its linked patient (`ContactRecord`), which `resolveContact` turns into
 * the view. A linked contact's own name, phone and e-mail stay null (design addendum C1).
 */
@Injectable()
export class ContactsRepository {
  constructor(private readonly db: TenantDb) {}

  insert(input: NewContactRow): Promise<DomainContact> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .insert(contacts)
        .values({
          id: newId(),
          fullName: input.fullName,
          nameKey: nameKey(input.fullName),
          ...phoneColumns(input.phone),
          email: input.email,
        })
        .returning();
      if (!row) throw new Error('contact insert returned no row');
      return toDomainContact(row);
    });
  }

  /**
   * A contact that *is* patient `patientId` (the `{ patientId }` link target): no fields of its
   * own. A second live one for the same patient → `ContactConflictError` (partial unique index).
   */
  insertLinked(patientId: string): Promise<DomainContact> {
    return this.db.run((tx) =>
      oneContactPerPatient(async () => {
        const [row] = await tx
          .insert(contacts)
          .values({ id: newId(), linkedPatientId: patientId })
          .returning();
        if (!row) throw new Error('contact insert returned no row');
        return toDomainContact(row);
      }),
    );
  }

  /** Changes a live, unlinked contact; undefined for a linked, deleted or invisible one. */
  update(id: string, patch: ContactFieldsPatch): Promise<DomainContact | undefined> {
    const set: Partial<typeof contacts.$inferInsert> = {};
    if (patch.fullName !== undefined) {
      set.fullName = patch.fullName;
      set.nameKey = nameKey(patch.fullName);
    }
    if (patch.phone !== undefined) Object.assign(set, phoneColumns(patch.phone));
    if (patch.email !== undefined) set.email = patch.email;
    return this.db.run(async (tx) => {
      const [row] = await tx
        .update(contacts)
        .set({ ...set, updatedAt: DB_NOW })
        .where(
          and(eq(contacts.id, id), isNull(contacts.deletedAt), isNull(contacts.linkedPatientId)),
        )
        .returning();
      return row ? toDomainContact(row) : undefined;
    });
  }

  async findById(id: string): Promise<ContactRecord | undefined> {
    const [record] = await this.findWhere(eq(contacts.id, id));
    return record;
  }

  findByIds(ids: readonly string[]): Promise<ContactRecord[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.findWhere(idAmong(contacts.id, ids));
  }

  /**
   * Makes a live, unlinked contact patient `patientId` ("the mother becomes a patient", C4): sets
   * `linked_patient_id` and clears the own name, phone and e-mail in the same update, so the
   * contact reads them from the patient from now on. Undefined when the contact is linked
   * already, deleted or invisible; `ContactConflictError` when the patient already has one.
   */
  linkToPatient(contactId: string, patientId: string): Promise<DomainContact | undefined> {
    return this.db.run((tx) =>
      oneContactPerPatient(async () => {
        const [row] = await tx
          .update(contacts)
          .set({
            linkedPatientId: patientId,
            fullName: null,
            nameKey: null,
            phone: null,
            phoneSearch: null,
            email: null,
            updatedAt: DB_NOW,
          })
          .where(
            and(
              eq(contacts.id, contactId),
              isNull(contacts.deletedAt),
              isNull(contacts.linkedPatientId),
            ),
          )
          .returning();
        return row ? toDomainContact(row) : undefined;
      }),
    );
  }

  /**
   * Reads the live contacts among `ids` `FOR UPDATE`, locked in id order (so two planners never
   * deadlock), with their linked patients (not locked; the service locks patients itself). For
   * planning a link to existing contacts. Must run inside an already-open transaction (throws
   * otherwise, like `PatientsRepository.lockPair`). Ids invisible under RLS are absent.
   */
  async findByIdsForUpdate(ids: readonly string[]): Promise<ContactRecord[]> {
    requireTransaction(this.db, 'findByIdsForUpdate');
    if (ids.length === 0) return [];
    const rows = await this.db.run((tx) =>
      tx
        .select({ contact: contacts, linkedPatient: linkedPatients })
        .from(contacts)
        .leftJoin(linkedPatients, eq(linkedPatients.id, contacts.linkedPatientId))
        .where(and(idAmong(contacts.id, ids), isNull(contacts.deletedAt)))
        .orderBy(contacts.id)
        .for('update', { of: contacts }),
    );
    return rows.map((row) => ({
      contact: toDomainContact(row.contact),
      linkedPatient: toLinkedPatient(row.linkedPatient),
    }));
  }

  /**
   * Everything a link change reads about contacts, in one statement so the rows are locked in a
   * single id order (two planners never deadlock): the live contacts among `ids` and the live
   * contacts that are the patients `linkedPatientIds` (the `{ patientId }` targets), `FOR UPDATE`,
   * with their linked patients (not locked; the service locked the patients first). Must run inside
   * an already-open transaction (throws otherwise).
   */
  async lockForLinking(
    ids: readonly string[],
    linkedPatientIds: readonly string[],
  ): Promise<ContactRecord[]> {
    requireTransaction(this.db, 'lockForLinking');
    if (ids.length === 0 && linkedPatientIds.length === 0) return [];
    const rows = await this.db.run((tx) =>
      tx
        .select({ contact: contacts, linkedPatient: linkedPatients })
        .from(contacts)
        .leftJoin(linkedPatients, eq(linkedPatients.id, contacts.linkedPatientId))
        .where(
          and(
            or(idAmong(contacts.id, ids), idAmong(contacts.linkedPatientId, linkedPatientIds)),
            isNull(contacts.deletedAt),
          ),
        )
        .orderBy(contacts.id)
        .for('update', { of: contacts }),
    );
    return rows.map((row) => ({
      contact: toDomainContact(row.contact),
      linkedPatient: toLinkedPatient(row.linkedPatient),
    }));
  }

  /**
   * The live contacts that are the patients `patientIds` (a merge's kept and dropped patients),
   * locked `FOR UPDATE` in id order. Must run inside an already-open transaction (throws
   * otherwise).
   */
  async linkedToPatientsForUpdate(patientIds: readonly string[]): Promise<DomainContact[]> {
    requireTransaction(this.db, 'linkedToPatientsForUpdate');
    if (patientIds.length === 0) return [];
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(contacts)
        .where(and(idAmong(contacts.linkedPatientId, patientIds), isNull(contacts.deletedAt)))
        .orderBy(contacts.id)
        .for('update'),
    );
    return rows.map(toDomainContact);
  }

  /** The live contact that is patient `patientId`, if any (at most one: unique index). */
  async findByLinkedPatient(patientId: string): Promise<DomainContact | undefined> {
    const [row] = await this.db.run((tx) =>
      tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.linkedPatientId, patientId), isNull(contacts.deletedAt))),
    );
    return row ? toDomainContact(row) : undefined;
  }

  /**
   * The search-or-create lookup (C5): live contacts whose resolved name contains `q`
   * (diacritics-insensitive, via `nameKey`) or, when `q` has at least 2 digits, whose resolved
   * phone digits contain them. Ordered by resolved name, then id; at most `limit`.
   */
  lookup(q: string, limit: number): Promise<ContactRecord[]> {
    return this.findWhere(lookupMatch(resolvedNameKey, resolvedPhoneSearch, q), limit);
  }

  /**
   * Live contacts whose resolved phone is exactly the E.164 number with these digits (e.g. the
   * digits of a number normalised with the tenant's country, C12).
   */
  findByPhoneDigits(e164Digits: string): Promise<ContactRecord[]> {
    return this.findWhere(sql`${resolvedPhone} = ${`+${e164Digits}`}`);
  }

  /**
   * Merge (C8): these contacts become the patient `patientId` (`linked_patient_id`);
   * `ContactConflictError` when that patient already has a live contact.
   */
  async relink(contactIds: readonly string[], patientId: string): Promise<void> {
    if (contactIds.length === 0) return;
    await this.db.run((tx) =>
      oneContactPerPatient(() =>
        tx
          .update(contacts)
          .set({ linkedPatientId: patientId, updatedAt: DB_NOW })
          .where(and(idAmong(contacts.id, contactIds), isNull(contacts.deletedAt))),
      ),
    );
  }

  /** Soft-deletes the live contacts among `ids` (a merge fold, C8). */
  async softDelete(ids: readonly string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.db.run((tx) =>
      tx
        .update(contacts)
        .set({ deletedAt: at, updatedAt: DB_NOW })
        .where(and(idAmong(contacts.id, ids), isNull(contacts.deletedAt))),
    );
  }

  private async findWhere(condition: SQL | undefined, limit?: number): Promise<ContactRecord[]> {
    const rows = await this.db.run((tx) => {
      const query = tx
        .select({ contact: contacts, linkedPatient: linkedPatients })
        .from(contacts)
        .leftJoin(linkedPatients, eq(linkedPatients.id, contacts.linkedPatientId))
        .where(and(isNull(contacts.deletedAt), condition))
        .orderBy(resolvedNameKey, contacts.id)
        .$dynamic();
      return limit === undefined ? query : query.limit(limit);
    });
    return rows.map((row) => ({
      contact: toDomainContact(row.contact),
      linkedPatient: toLinkedPatient(row.linkedPatient),
    }));
  }
}

/** The `…ForUpdate` reads lock rows for the caller's transaction, so one must be open. */
export function requireTransaction(db: TenantDb, method: string): void {
  if (!db.currentTransaction()) throw new Error(`${method} must run inside a transaction`);
}
