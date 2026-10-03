import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Transaction } from '../../../platform/db/database';
import { TenantDb } from '../../../platform/db/tenant-db';
import { isUniqueViolation } from '../../../platform/db/unique-violation';
import { ContactAlreadyLinkedError, ContactConflictError } from '../domain/contact-errors';
import type {
  ContactMergePlan,
  DomainContact,
  LinkedPatientFacts,
  LinkKey,
  LinkPlan,
  LinkState,
  PatientLink,
} from '../domain/contacts';
import { linkedPatients } from './contact-resolution.sql';
import { requireTransaction, toDomainContact, toLinkedPatient } from './contacts.repository';
import { contacts, patientContacts } from './schema';

type LinkRow = typeof patientContacts.$inferSelect;

/** Same database clock as `patients` (see `PatientsRepository`). */
const DB_NOW = sql`now()`;

function toLink(row: LinkRow): PatientLink {
  return {
    patientId: row.patientId,
    contactId: row.contactId,
    relationship: row.relationship,
    isGuardian: row.isGuardian,
    isBillingContact: row.isBillingContact,
    isEmergencyContact: row.isEmergencyContact,
    isPrimaryGuardian: row.isPrimaryGuardian,
    isPrimaryBilling: row.isPrimaryBilling,
    isPrimaryEmergency: row.isPrimaryEmergency,
    createdAt: row.createdAt,
  };
}

/** A patient's link with its contact and, for a linked contact, that contact's patient. */
export interface PatientContactRecord {
  link: PatientLink;
  contact: DomainContact;
  linkedPatient: LinkedPatientFacts | null;
}

const PRIMARY_INDEXES = [
  'patient_contacts_primary_guardian_unique',
  'patient_contacts_primary_billing_unique',
  'patient_contacts_primary_emergency_unique',
];

/**
 * Runs a plan's writes, turning a unique-index race into a domain error instead of a 500: a
 * second primary for a role (a plan built from rows another transaction changed meanwhile) →
 * `ContactConflictError` (409 `contact.conflict`); a link that exists already →
 * `ContactAlreadyLinkedError` (409). Planning from `…ForUpdate` reads avoids both.
 */
async function mapLinkViolations(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    const index = PRIMARY_INDEXES.find((constraint) => isUniqueViolation(error, constraint));
    if (index) {
      throw new ContactConflictError(
        "The patient's contacts changed meanwhile; reload and try again",
        { constraint: index },
      );
    }
    if (isUniqueViolation(error, 'patient_contacts_pk')) {
      throw new ContactAlreadyLinkedError('This contact is already linked');
    }
    throw error;
  }
}

function keyIs(key: LinkKey) {
  return and(
    eq(patientContacts.patientId, key.patientId),
    eq(patientContacts.contactId, key.contactId),
  );
}

const NO_PRIMARY = { isPrimaryGuardian: false, isPrimaryBilling: false, isPrimaryEmergency: false };

function flagsOf(state: LinkState) {
  return {
    relationship: state.relationship,
    isGuardian: state.isGuardian,
    isBillingContact: state.isBillingContact,
    isEmergencyContact: state.isEmergencyContact,
    isPrimaryGuardian: state.isPrimaryGuardian,
    isPrimaryBilling: state.isPrimaryBilling,
    isPrimaryEmergency: state.isPrimaryEmergency,
  };
}

/**
 * `patient_contacts` of the current tenant (RLS; CLAUDE.md §5): a junction, hard-deleted on
 * unlink. The primary rules live in `domain/contacts.ts`, and production code writes links only
 * through their plans: `applyLinkPlan`/`applyMergePlan` write a plan in one transaction, in an
 * order the "one primary per role" indexes accept. Plan from the `…ForUpdate` reads, after
 * locking the patient row(s) (`PatientsRepository.findForUpdate`/`lockPair`).
 */
@Injectable()
export class PatientContactsRepository {
  constructor(private readonly db: TenantDb) {}

  /**
   * A patient's contacts, resolved: primaries first, then oldest link first. Soft-deleted
   * contacts are left out (a merge fold moves their links before deleting them).
   */
  async listForPatient(patientId: string): Promise<PatientContactRecord[]> {
    const isPrimary = sql`(${patientContacts.isPrimaryGuardian} or ${patientContacts.isPrimaryBilling} or ${patientContacts.isPrimaryEmergency})`;
    const rows = await this.db.run((tx) =>
      tx
        .select({ link: patientContacts, contact: contacts, linkedPatient: linkedPatients })
        .from(patientContacts)
        .innerJoin(
          contacts,
          and(eq(contacts.id, patientContacts.contactId), isNull(contacts.deletedAt)),
        )
        .leftJoin(linkedPatients, eq(linkedPatients.id, contacts.linkedPatientId))
        .where(eq(patientContacts.patientId, patientId))
        .orderBy(desc(isPrimary), asc(patientContacts.createdAt), asc(patientContacts.contactId)),
    );
    return rows.map((row) => ({
      link: toLink(row.link),
      contact: toDomainContact(row.contact),
      linkedPatient: toLinkedPatient(row.linkedPatient),
    }));
  }

  /** Every link of a patient, oldest first: the input of `planLinkChange`/`planContactMerge`. */
  async linksOf(patientId: string): Promise<PatientLink[]> {
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(patientContacts)
        .where(eq(patientContacts.patientId, patientId))
        .orderBy(asc(patientContacts.createdAt), asc(patientContacts.contactId)),
    );
    return rows.map(toLink);
  }

  /**
   * `linksOf`, with the rows locked `FOR UPDATE` until the caller's transaction ends: the input
   * of a plan. Must run inside an already-open transaction (throws otherwise).
   */
  async linksOfForUpdate(patientId: string): Promise<PatientLink[]> {
    requireTransaction(this.db, 'linksOfForUpdate');
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(patientContacts)
        .where(eq(patientContacts.patientId, patientId))
        .orderBy(asc(patientContacts.createdAt), asc(patientContacts.contactId))
        .for('update'),
    );
    return rows.map(toLink);
  }

  /** Every link of a contact, on any patient, oldest first. */
  async listForContact(contactId: string): Promise<PatientLink[]> {
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(patientContacts)
        .where(eq(patientContacts.contactId, contactId))
        .orderBy(asc(patientContacts.createdAt), asc(patientContacts.patientId)),
    );
    return rows.map(toLink);
  }

  /**
   * `listForContact`, with the rows locked `FOR UPDATE` (a merge fold re-points a linked
   * contact's links on other patients). Must run inside an already-open transaction.
   */
  async listForContactForUpdate(contactId: string): Promise<PatientLink[]> {
    requireTransaction(this.db, 'listForContactForUpdate');
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(patientContacts)
        .where(eq(patientContacts.contactId, contactId))
        .orderBy(asc(patientContacts.createdAt), asc(patientContacts.patientId))
        .for('update'),
    );
    return rows.map(toLink);
  }

  /**
   * The primary billing contact of each of `patientIds` that has one, resolved (feature 5:
   * Outstanding grouped by payer). Soft-deleted contacts are left out.
   */
  async primaryBillingFor(
    patientIds: readonly string[],
  ): Promise<(Omit<PatientContactRecord, 'link'> & { patientId: string })[]> {
    if (patientIds.length === 0) return [];
    const rows = await this.db.run((tx) =>
      tx
        .select({
          patientId: patientContacts.patientId,
          contact: contacts,
          linkedPatient: linkedPatients,
        })
        .from(patientContacts)
        .innerJoin(
          contacts,
          and(eq(contacts.id, patientContacts.contactId), isNull(contacts.deletedAt)),
        )
        .leftJoin(linkedPatients, eq(linkedPatients.id, contacts.linkedPatientId))
        .where(
          and(
            inArray(patientContacts.patientId, [...patientIds]),
            eq(patientContacts.isPrimaryBilling, true),
          ),
        ),
    );
    return rows.map((row) => ({
      patientId: row.patientId,
      contact: toDomainContact(row.contact),
      linkedPatient: toLinkedPatient(row.linkedPatient),
    }));
  }

  /** The patients linking `contactId` as their billing contact (C12), archived ones included. */
  async patientsBilledBy(contactId: string): Promise<string[]> {
    const rows = await this.db.run((tx) =>
      tx
        .select({ patientId: patientContacts.patientId })
        .from(patientContacts)
        .where(
          and(eq(patientContacts.contactId, contactId), eq(patientContacts.isBillingContact, true)),
        )
        .orderBy(asc(patientContacts.createdAt), asc(patientContacts.patientId)),
    );
    return rows.map((row) => row.patientId);
  }

  /** Applies a `planLinkChange` result in one transaction, in the order `LinkPlan` documents. */
  async applyLinkPlan(plan: LinkPlan): Promise<void> {
    await this.db.run((tx) =>
      mapLinkViolations(async () => {
        await deleteLinks(tx, plan.deletes);
        for (const state of plan.updates) await writeLink(tx, state, NO_PRIMARY);
        for (const state of plan.updates) await writeLink(tx, state, state);
        for (const state of plan.inserts) await insertLink(tx, state);
      }),
    );
  }

  /**
   * Applies the link side of a `planContactMerge` result (the contacts side — `relinks`, and
   * soft-deleting the folded contacts — is `ContactsRepository`'s) in one transaction, in the order
   * `ContactMergePlan` documents. `droppedId` is where the `moves` rows are now.
   */
  async applyMergePlan(droppedId: string, plan: ContactMergePlan): Promise<void> {
    await this.db.run((tx) => mapLinkViolations(() => writeMerge(tx, droppedId, plan)));
  }
}

/** The writes of `applyMergePlan`, in the order `ContactMergePlan` documents. */
async function writeMerge(tx: Transaction, droppedId: string, plan: ContactMergePlan) {
  await deleteLinks(tx, plan.deletes);
  const moved = (state: LinkState): LinkState => ({ ...state, patientId: droppedId });
  for (const state of plan.updates) await writeLink(tx, state, NO_PRIMARY);
  for (const state of plan.moves) await writeLink(tx, moved(state), NO_PRIMARY);
  for (const state of plan.updates) await writeLink(tx, state, state);
  for (const state of plan.moves) {
    await tx
      .update(patientContacts)
      .set({ ...flagsOf(state), patientId: state.patientId, updatedAt: DB_NOW })
      .where(keyIs(moved(state)));
  }
  for (const fold of plan.folds) {
    for (const key of fold.repoints) {
      await tx
        .update(patientContacts)
        .set({ contactId: fold.intoContactId, updatedAt: DB_NOW })
        .where(keyIs(key));
    }
  }
}

/**
 * `created_at` from `clock_timestamp()`, not the transaction's `now()`: links created in one
 * transaction (a create with several contacts) keep their order, which promotion relies on.
 */
function insertLink(tx: Transaction, state: LinkState) {
  return tx.insert(patientContacts).values({
    patientId: state.patientId,
    contactId: state.contactId,
    ...flagsOf(state),
    createdAt: sql`clock_timestamp()`,
  });
}

/** Writes `values` (a full state, or just cleared primaries) onto the link keyed by `key`. */
function writeLink(tx: Transaction, key: LinkKey, values: LinkState | typeof NO_PRIMARY) {
  const set = 'relationship' in values ? flagsOf(values) : values;
  return tx
    .update(patientContacts)
    .set({ ...set, updatedAt: DB_NOW })
    .where(keyIs(key))
    .returning({ contactId: patientContacts.contactId });
}

async function deleteLinks(tx: Transaction, keys: readonly LinkKey[]): Promise<void> {
  if (keys.length === 0) return;
  await tx.delete(patientContacts).where(or(...keys.map(keyIs)));
}
