import {
  type ContactLinkInput,
  type ContactLinkPatch,
  type ContactLookupItem,
  type ContactLookupQuery,
  type ContactPatch,
  type ContactView,
  normalizePhone,
  type PatientContact,
  type PatientListItem,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import { AuditService } from '../../audit';
import { TenancyService } from '../../tenancy';
import { ContactLinkedError, ContactNotFoundError } from '../domain/contact-errors';
import {
  CONTACT_ROLES,
  type ContactRole,
  type LinkChange,
  planLinkChange,
  resolveContact,
} from '../domain/contacts';
import { nameKey } from '../domain/name-key';
import type { DomainPatient } from '../domain/patient';
import {
  PatientArchivedError,
  PatientMergedError,
  PatientNotFoundError,
} from '../domain/patient-errors';
import {
  CONTACT_UNLINKED,
  CONTACT_UPDATED,
  type ContactUnlinked,
  type ContactUpdated,
} from '../events/contact-events';
import { type ContactFieldsPatch, ContactsRepository } from '../persistence/contacts.repository';
import { PatientContactsRepository } from '../persistence/patient-contacts.repository';
import { PatientsRepository } from '../persistence/patients.repository';
import { type LinkRequest, ContactLinks } from './contact-links';
import { linkAudit, toPatientContact } from './contact-mapping';
import { toListItem } from './patient-mapping';

/** The search-or-create lookup returns at most this many rows (addendum C5). */
const LOOKUP_LIMIT = 10;

const PATIENT_NOT_FOUND = 'Patient not found';
const CONTACT_NOT_FOUND = 'Contact not found';

const PRIMARY_FLAG = {
  guardian: 'isPrimaryGuardian',
  billing: 'isPrimaryBilling',
  emergency: 'isPrimaryEmergency',
} as const satisfies Record<ContactRole, keyof ContactLinkPatch>;

/**
 * Contacts & family (design addendum C5, C11, C12; ADR-0019): a patient's contacts and their
 * roles, the contacts themselves, the search-or-create lookup and the read API other modules use
 * (`contactsOf`, `patientsBilledBy`, `findContactsByPhone`). Reads need `patient:read`, writes
 * `patient:write` (re-checked here, not only at the route). Writes follow the lock order of
 * `ContactLinks`, are audited in their transaction and emit their events after commit.
 */
@Injectable()
export class ContactsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
    private readonly patients: PatientsRepository,
    private readonly contacts: ContactsRepository,
    private readonly links: PatientContactsRepository,
    private readonly contactLinks: ContactLinks,
  ) {}

  // --- Read API (exported for features 5–6, addendum C12) ---

  /** A patient's contacts, resolved: primaries first, then oldest link. Archived patients too. */
  async contactsOf(patientId: string): Promise<PatientContact[]> {
    this.context.requirePermission('patient:read');
    return this.tenantDb.run(async () => {
      if (!(await this.patients.findById(patientId))) {
        throw new PatientNotFoundError(PATIENT_NOT_FOUND);
      }
      return (await this.links.listForPatient(patientId)).map(toPatientContact);
    });
  }

  /**
   * The patients who link `contactId` as their billing contact (household views, addendum C12),
   * archived ones included, by name. An unknown or deleted contact → 404 `contact.not_found`.
   */
  async patientsBilledBy(contactId: string): Promise<PatientListItem[]> {
    this.context.requirePermission('patient:read');
    return this.tenantDb.run(async () => {
      if (!(await this.contacts.findById(contactId))) {
        throw new ContactNotFoundError(CONTACT_NOT_FOUND);
      }
      const ids = await this.links.patientsBilledBy(contactId);
      return (await this.patients.listRowsByIds(ids)).map(toListItem);
    });
  }

  /** One contact, resolved (feature 5: a family's payer). Unknown or deleted → 404. */
  async contactView(contactId: string): Promise<ContactView> {
    this.context.requirePermission('patient:read');
    return this.tenantDb.run(async () => {
      const record = await this.contacts.findById(contactId);
      if (!record) throw new ContactNotFoundError(CONTACT_NOT_FOUND);
      return resolveContact(record.contact, record.linkedPatient);
    });
  }

  /**
   * The contact that is patient `patientId` (C4: "the mother becomes a patient"), resolved, or
   * null — so a parent's own record can show the family they pay for (feature 5).
   */
  async contactOfPatient(patientId: string): Promise<ContactView | null> {
    this.context.requirePermission('patient:read');
    return this.tenantDb.run(async () => {
      const contact = await this.contacts.findByLinkedPatient(patientId);
      const record = contact ? await this.contacts.findById(contact.id) : undefined;
      return record ? resolveContact(record.contact, record.linkedPatient) : null;
    });
  }

  /**
   * The primary billing contact of each of `patientIds` that has one, resolved, in no particular
   * order (feature 5: Outstanding grouped by payer).
   */
  async primaryBillingContacts(
    patientIds: readonly string[],
  ): Promise<{ patientId: string; contact: ContactView }[]> {
    this.context.requirePermission('patient:read');
    return this.tenantDb.run(async () =>
      (await this.links.primaryBillingFor(patientIds)).map((row) => ({
        patientId: row.patientId,
        contact: resolveContact(row.contact, row.linkedPatient),
      })),
    );
  }

  /**
   * The contacts whose resolved phone is `phone`, normalised with the tenant's country (e.g. an
   * import matching a guardian's phone). A phone that does not parse matches nobody: `[]`.
   */
  async findContactsByPhone(phone: string): Promise<ContactView[]> {
    this.context.requirePermission('patient:read');
    const { country } = await this.tenancy.currentTenant();
    const normalized = normalizePhone(phone, country);
    if (!normalized) return [];
    const records = await this.contacts.findByPhone(normalized.e164);
    return records.map((record) => resolveContact(record.contact, record.linkedPatient));
  }

  /**
   * Search-or-create (addendum C5): contacts, and active patients who are nobody's contact yet,
   * whose name contains `q` or whose phone digits contain its digits (at least 2). A patient
   * with a linked contact appears once, as that contact. At most 10, by name key (diacritics-
   * insensitive) in code-point order, contacts before patients on a tie, then id. Each half is
   * cut at 10 in SQL in the same order (`byNameKey`), so merging them here keeps the first 10.
   */
  async lookup(query: ContactLookupQuery): Promise<ContactLookupItem[]> {
    this.context.requirePermission('patient:read');
    const { contacts, patients } = await this.tenantDb.run(async () => ({
      contacts: await this.contacts.lookup(query.q, LOOKUP_LIMIT),
      patients: await this.patients.lookupUnlinked(query.q, LOOKUP_LIMIT),
    }));
    const rows: { key: string; rank: number; id: string; item: ContactLookupItem }[] = [
      ...contacts.map((record) => {
        const contact = resolveContact(record.contact, record.linkedPatient);
        const item: ContactLookupItem = { kind: 'contact', contact };
        // A linked contact's key is its patient's (`name_key` is derived from the name alike).
        const key = record.contact.nameKey ?? nameKey(contact.fullName);
        return { key, rank: 0, id: contact.id, item };
      }),
      ...patients.map((patient) => {
        const item: ContactLookupItem = {
          kind: 'patient',
          patient: {
            id: patient.id,
            displayNumber: patient.displayNumber,
            fullName: patient.fullName,
            phone: patient.phone,
            dateOfBirth: patient.dateOfBirth,
          },
        };
        return { key: patient.nameKey, rank: 1, id: patient.id, item };
      }),
    ];
    rows.sort((a, b) => byteOrder(a.key, b.key) || a.rank - b.rank || byteOrder(a.id, b.id));
    return rows.slice(0, LOOKUP_LIMIT).map((row) => row.item);
  }

  // --- A patient's links ---

  /**
   * Links a contact to the patient (`POST /patients/:id/contacts`). Returns the patient's
   * contacts. Unknown patient → 404; archived → 409 `patient.archived`; merged away → 409
   * `patient.merged`; target errors as `ContactLinks.link`; already linked → 409
   * `contact.already_linked`.
   */
  async link(patientId: string, input: ContactLinkInput): Promise<PatientContact[]> {
    this.context.requirePermission('patient:write');
    return this.tenantDb.run(async () => {
      const requests: LinkRequest[] = [{ input, path: '' }];
      const locked = await this.contactLinks.lockPatients(patientId, requests);
      assertWritable(locked.get(patientId));
      const tenant = await this.tenancy.currentTenant();
      await this.contactLinks.link(patientId, requests, locked, tenant);
      return this.listOf(patientId);
    });
  }

  /**
   * Changes a link's relationship, roles or primaries (`PATCH /patients/:id/contacts/:contactId`).
   * Making a contact a role's primary takes it from the previous one; removing a primary's role
   * promotes the oldest remaining holder (addendum C2). A patch that changes nothing writes and
   * audits nothing. Audited as `contact.roles` (before/after link). Returns the patient's contacts.
   */
  async updateLink(
    patientId: string,
    contactId: string,
    patch: ContactLinkPatch,
  ): Promise<PatientContact[]> {
    this.context.requirePermission('patient:write');
    return this.tenantDb.run(async () => {
      assertWritable(await this.patients.findForUpdate(patientId));
      const existing = await this.links.linksOfForUpdate(patientId);
      const before = existing.find((link) => link.contactId === contactId);
      if (!before) throw new ContactNotFoundError('This contact is not linked to the patient');
      const plan = planLinkChange(patientId, existing, updateChange(contactId, patch));
      if (plan.deletes.length + plan.updates.length + plan.inserts.length === 0) {
        return this.listOf(patientId);
      }
      await this.links.applyLinkPlan(plan);
      const after = (await this.links.linksOf(patientId)).find(
        (link) => link.contactId === contactId,
      );
      if (!after) throw new Error('updateLink: the link disappeared');
      const fullName = await this.nameOf(contactId);
      await this.audit.record({
        action: 'contact.roles',
        resourceType: 'patient',
        resourceId: patientId,
        before: linkAudit(before, fullName),
        after: linkAudit(after, fullName),
      });
      return this.listOf(patientId);
    });
  }

  /**
   * Unlinks a contact from the patient (`DELETE /patients/:id/contacts/:contactId`); a primary is
   * replaced by the oldest remaining holder of its role. The contact itself stays (lookup still
   * finds it). Audited as `contact.unlink`; emits `ContactUnlinked`. Returns the patient's
   * remaining contacts.
   */
  async unlink(patientId: string, contactId: string): Promise<PatientContact[]> {
    this.context.requirePermission('patient:write');
    return this.tenantDb.run(async () => {
      assertWritable(await this.patients.findForUpdate(patientId));
      const existing = await this.links.linksOfForUpdate(patientId);
      const before = existing.find((link) => link.contactId === contactId);
      if (!before) throw new ContactNotFoundError('This contact is not linked to the patient');
      const fullName = await this.nameOf(contactId);
      await this.links.applyLinkPlan(
        planLinkChange(patientId, existing, { kind: 'unlink', contactId }),
      );
      await this.audit.record({
        action: 'contact.unlink',
        resourceType: 'patient',
        resourceId: patientId,
        before: linkAudit(before, fullName),
      });
      const event: ContactUnlinked = this.events.create(CONTACT_UNLINKED, {
        patientId,
        contactId,
      });
      await this.events.publish(event);
      return this.listOf(patientId);
    });
  }

  // --- The contacts themselves ---

  /**
   * Edits an unlinked contact's name, phone or e-mail (`PATCH /contacts/:id`). A contact linked to
   * a patient → 409 `contact.linked` (edit the patient record); unknown → 404; an invalid phone →
   * 422 `validation_failed` at `phone`. Only changed fields are written; a patch that changes
   * nothing writes, audits and emits nothing. Audited as `contact.update` (resource `contact`);
   * emits `ContactUpdated`.
   */
  async updateContact(contactId: string, patch: ContactPatch): Promise<ContactView> {
    this.context.requirePermission('patient:write');
    return this.tenantDb.run(async () => {
      const [record] = await this.contacts.findByIdsForUpdate([contactId]);
      if (!record) throw new ContactNotFoundError(CONTACT_NOT_FOUND);
      const before = record.contact;
      if (before.linkedPatientId !== null) {
        throw new ContactLinkedError(
          'This contact is a patient: edit the patient record to change their details',
        );
      }
      const set: ContactFieldsPatch = {};
      if (patch.fullName !== undefined && patch.fullName !== before.fullName) {
        set.fullName = patch.fullName;
      }
      if (patch.phone !== undefined) {
        const { country } = await this.tenancy.currentTenant();
        const phone = normalizePhone(patch.phone, country);
        if (!phone) {
          const message = 'Not a valid phone number';
          throw new ValidationFailedError(message, [
            { path: 'phone', code: 'invalid_phone', message },
          ]);
        }
        if (phone.e164 !== before.phone) set.phone = phone;
      }
      if (patch.email !== undefined && patch.email !== before.email) set.email = patch.email;
      if (Object.keys(set).length === 0) return resolveContact(before);

      const updated = await this.contacts.update(contactId, set);
      if (!updated) throw new ContactNotFoundError(CONTACT_NOT_FOUND);
      await this.audit.record({
        action: 'contact.update',
        resourceType: 'contact',
        resourceId: contactId,
        before: ownFields(before),
        after: ownFields(updated),
      });
      const event: ContactUpdated = this.events.create(CONTACT_UPDATED, { contactId });
      await this.events.publish(event);
      return resolveContact(updated);
    });
  }

  private async listOf(patientId: string): Promise<PatientContact[]> {
    return (await this.links.listForPatient(patientId)).map(toPatientContact);
  }

  /** The resolved name of a contact the patient links (for the audit entry). */
  private async nameOf(contactId: string): Promise<string> {
    const record = await this.contacts.findById(contactId);
    if (!record) throw new ContactNotFoundError(CONTACT_NOT_FOUND);
    return resolveContact(record.contact, record.linkedPatient).fullName;
  }
}

/** Unknown → 404; merged away → 409 `patient.merged`; archived → 409 `patient.archived`. */
function assertWritable(patient: DomainPatient | undefined): void {
  if (!patient) throw new PatientNotFoundError(PATIENT_NOT_FOUND);
  if (patient.mergedIntoId !== null) {
    throw new PatientMergedError('This record was merged into another one; use the kept record');
  }
  if (patient.deletedAt !== null) {
    throw new PatientArchivedError("Archived patients' contacts cannot be changed; restore first");
  }
}

function updateChange(contactId: string, patch: ContactLinkPatch): LinkChange {
  const roles: { isGuardian?: boolean; isBillingContact?: boolean; isEmergencyContact?: boolean } =
    {};
  if (patch.isGuardian !== undefined) roles.isGuardian = patch.isGuardian;
  if (patch.isBillingContact !== undefined) roles.isBillingContact = patch.isBillingContact;
  if (patch.isEmergencyContact !== undefined) roles.isEmergencyContact = patch.isEmergencyContact;
  const makePrimary = CONTACT_ROLES.filter((role) => patch[PRIMARY_FLAG[role]] === true);
  return {
    kind: 'update',
    contactId,
    roles,
    makePrimary,
    ...(patch.relationship === undefined ? {} : { relationship: patch.relationship }),
  };
}

function ownFields(contact: {
  fullName: string | null;
  phone: string | null;
  email: string | null;
}) {
  return { fullName: contact.fullName, phone: contact.phone, email: contact.email };
}

/** The "C" collation's order: UTF-8 bytes (`byNameKey`; uuids sort the same way as text). */
function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
