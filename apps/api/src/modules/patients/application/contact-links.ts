import {
  type ContactLinkInput,
  type ContactLinkTarget,
  normalizePhone,
  type Tenant,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { EventBus } from '../../../platform/events/event-bus';
import type { Clock } from '../../../platform/kernel/clock';
import {
  type ValidationIssue,
  ValidationFailedError,
} from '../../../platform/kernel/validation-failed.error';
import { AuditService } from '../../audit';
import {
  ContactAlreadyLinkedError,
  ContactConflictError,
  ContactIsPatientError,
} from '../domain/contact-errors';
import {
  assertNotOwnContact,
  type DomainContact,
  planContactMerge,
  planLinkChange,
  resolveContact,
} from '../domain/contacts';
import type { DomainPatient } from '../domain/patient';
import {
  CONTACT_LINKED,
  CONTACT_UPDATED,
  type ContactLinked,
  type ContactUpdated,
} from '../events/contact-events';
import {
  type ContactRecord,
  ContactsRepository,
  type NewContactRow,
} from '../persistence/contacts.repository';
import { PatientContactsRepository } from '../persistence/patient-contacts.repository';
import { PatientsRepository } from '../persistence/patients.repository';
import { linkAudit } from './contact-mapping';

/** One link to make, and where its errors point in the request body. */
export interface LinkRequest {
  input: ContactLinkInput;
  /** `contacts.2` inside a create; `''` for `POST /patients/:id/contacts` (the body is the link). */
  path: string;
}

/** A request whose contact is known: an existing (locked) one, or one to create. */
interface ResolvedLink {
  input: ContactLinkInput;
  contact:
    | { kind: 'existing'; id: string }
    | { kind: 'ofPatient'; patientId: string }
    | { kind: 'new'; row: NewContactRow };
  /** The resolved name, for the audit entry. */
  fullName: string;
}

const MERGED_TARGET = 'This record was merged into another one; use the kept record';

function joinPath(prefix: string, suffix: string): string {
  return prefix === '' ? suffix : `${prefix}.${suffix}`;
}

function targetPatientId(target: ContactLinkTarget): string | undefined {
  return 'patientId' in target ? target.patientId : undefined;
}

function targetContactId(target: ContactLinkTarget): string | undefined {
  return 'contactId' in target ? target.contactId : undefined;
}

/**
 * The write side of contacts shared by `PatientsService` (create, merge) and `ContactsService`
 * (the contact routes): resolving link targets, linking, and a merge's contacts. Internal to the
 * module.
 *
 * **Lock order** (every contact write follows it, so no two of them deadlock): patient rows, in id
 * order, in one statement → contact rows, in id order, in one statement → link rows. A create
 * takes the tenant's patient counter before all of these (only creates take it). Every link
 * writer holds the lock of the patient whose links it writes, so link rows are never contended
 * out of order. A unique-index race that slips through surfaces as 409 `contact.conflict` and
 * aborts the transaction; nothing catches it and keeps writing.
 */
@Injectable()
export class ContactLinks {
  constructor(
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly patients: PatientsRepository,
    private readonly contacts: ContactsRepository,
    private readonly links: PatientContactsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The first step of a link: locks `subjectId` (the patient being linked to) and the patients the
   * requests target, in one statement in id order. Returns the locked rows by id; the caller
   * checks the subject (a new patient in a create, or 404/409 for the contact routes).
   */
  async lockPatients(
    subjectId: string,
    requests: readonly LinkRequest[],
  ): Promise<Map<string, DomainPatient>> {
    const ids = [subjectId];
    for (const request of requests) {
      const patientId = targetPatientId(request.input.target);
      if (patientId !== undefined) ids.push(patientId);
    }
    const locked = await this.patients.findByIdsForUpdate([...new Set(ids)]);
    return new Map(locked.map((patient) => [patient.id, patient]));
  }

  /**
   * Links `requests` to patient `subjectId` (addendum C4, C5), inside the caller's transaction,
   * after `lockPatients`. Every target is checked before anything is written: an unknown contact
   * or patient (or a merged-away one) → 422 `validation_failed` at `<path>.target.contactId` /
   * `<path>.target.patientId`, an invalid new phone at `<path>.target.newContact.phone`, two
   * requests reaching the same contact at `<path>` (`duplicate`); the patient itself → 422
   * `contact.is_patient`. `becomes` (a create's `linkContactId`) must be an unlinked contact
   * (unknown → 422 at `linkContactId`, linked → 409 `contact.already_linked`); it becomes the
   * patient first. Then each link is planned (`planLinkChange`: the first holder of a role becomes
   * its primary), applied, audited (`contact.link`) and announced (`ContactLinked`) in order.
   */
  async link(
    subjectId: string,
    requests: readonly LinkRequest[],
    locked: ReadonlyMap<string, DomainPatient>,
    tenant: Pick<Tenant, 'country'>,
    becomes?: string,
  ): Promise<void> {
    const issues: ValidationIssue[] = [];
    const targetPatients = this.checkTargetPatients(subjectId, requests, locked, issues);
    const contactIds = requests.flatMap((request) => targetContactId(request.input.target) ?? []);
    const records = await this.contacts.lockForLinking(
      becomes === undefined ? contactIds : [...contactIds, becomes],
      targetPatients,
    );
    const byId = new Map(records.map((record) => [record.contact.id, record]));
    const byPatient = new Map(
      records.flatMap((record) =>
        record.contact.linkedPatientId === null ? [] : [[record.contact.linkedPatientId, record]],
      ),
    );

    const resolved: ResolvedLink[] = [];
    const seen = new Set<string>();
    for (const request of requests) {
      const link = this.resolve(subjectId, request, locked, byId, byPatient, tenant, issues);
      if (!link) continue;
      if (link.contact.kind === 'existing') {
        if (seen.has(link.contact.id)) {
          issues.push({
            path: request.path,
            code: 'duplicate',
            message: 'The same contact is linked twice',
          });
        }
        seen.add(link.contact.id);
      }
      resolved.push(link);
    }
    const becoming = becomes === undefined ? undefined : byId.get(becomes);
    if (becomes !== undefined && !becoming) {
      issues.push({ path: 'linkContactId', code: 'not_found', message: 'Contact not found' });
    }
    if (issues.length > 0) throw new ValidationFailedError(issuesMessage(issues), issues);
    if (becoming) await this.becomePatient(becoming.contact, subjectId);

    let current = await this.links.linksOfForUpdate(subjectId);
    for (const link of resolved) {
      const contactId = await this.contactIdFor(link);
      const plan = planLinkChange(subjectId, current, {
        kind: 'link',
        contactId,
        relationship: link.input.relationship,
        roles: {
          isGuardian: link.input.isGuardian,
          isBillingContact: link.input.isBillingContact,
          isEmergencyContact: link.input.isEmergencyContact,
        },
      });
      await this.links.applyLinkPlan(plan);
      current = await this.links.linksOfForUpdate(subjectId);
      const created = current.find((row) => row.contactId === contactId);
      if (!created) throw new Error('link: the new link was not written');
      await this.audit.record({
        action: 'contact.link',
        resourceType: 'patient',
        resourceId: subjectId,
        after: linkAudit(created, link.fullName),
      });
      const event: ContactLinked = this.events.create(CONTACT_LINKED, {
        patientId: subjectId,
        contactId,
      });
      await this.events.publish(event);
    }
  }

  /**
   * The patients whose links a merge of `droppedId` into `keptId` would rewrite besides the two:
   * when both have a linked contact, the dropped one is folded into the kept one and its links on
   * other patients move (addendum C8). Read without locks, before the merge locks the patients;
   * `mergeContacts` re-checks the set under the locks.
   */
  async mergeTouches(keptId: string, droppedId: string): Promise<string[]> {
    const dropped = await this.contacts.findByLinkedPatient(droppedId);
    if (!dropped || !(await this.contacts.findByLinkedPatient(keptId))) return [];
    const links = await this.links.listForContact(dropped.id);
    return links
      .map((link) => link.patientId)
      .filter((patientId) => patientId !== keptId && patientId !== droppedId);
  }

  /**
   * The contacts side of a merge (addendum C8), after the merge locked `keptId`, `droppedId` and
   * the patients `mergeTouches` returned (`lockedPatientIds`): locks the two linked contacts, then
   * the links of both patients and, for a fold, the dropped contact's links; plans
   * (`planContactMerge`) and applies. A fold that would now rewrite links of a patient the merge
   * did not lock (a link made meanwhile) → 409 `contact.conflict`, and the merge rolls back.
   * Audits one `contact.merge` summary on the kept patient when anything changed.
   */
  async mergeContacts(
    keptId: string,
    droppedId: string,
    lockedPatientIds: ReadonlySet<string>,
  ): Promise<void> {
    const selves = await this.contacts.linkedToPatientsForUpdate([keptId, droppedId]);
    const keptSelf = selves.find((contact) => contact.linkedPatientId === keptId);
    const droppedSelf = selves.find((contact) => contact.linkedPatientId === droppedId);
    const keptLinks = await this.links.linksOfForUpdate(keptId);
    const droppedLinks = await this.links.linksOfForUpdate(droppedId);
    const fold = keptSelf !== undefined && droppedSelf !== undefined;
    const droppedSelfLinks = droppedSelf
      ? fold
        ? await this.links.listForContactForUpdate(droppedSelf.id)
        : []
      : [];
    if (droppedSelfLinks.some((link) => !lockedPatientIds.has(link.patientId))) {
      throw new ContactConflictError(
        "The records' contacts changed during the merge; try the merge again",
      );
    }
    // Only the kept contact's links on patients the dropped one also links are read by the plan;
    // those patients are locked, so the rows cannot change under it.
    const keptSelfLinks = keptSelf && fold ? await this.links.listForContact(keptSelf.id) : [];

    const plan = planContactMerge({
      keptId,
      droppedId,
      keptLinks,
      droppedLinks,
      keptLinkedContact: keptSelf ? { contactId: keptSelf.id, links: keptSelfLinks } : null,
      droppedLinkedContact: droppedSelf
        ? { contactId: droppedSelf.id, links: droppedSelfLinks }
        : null,
    });
    await this.links.applyMergePlan(droppedId, plan);
    await this.contacts.relink(plan.relinks, keptId);
    const folded = plan.folds.map((entry) => entry.fromContactId);
    await this.contacts.softDelete(folded, this.clock.now());

    const changed =
      plan.deletes.length + plan.updates.length + plan.moves.length + plan.relinks.length > 0 ||
      folded.length > 0;
    if (!changed) return;
    await this.audit.record({
      action: 'contact.merge',
      resourceType: 'patient',
      resourceId: keptId,
      after: {
        droppedId,
        movedLinks: plan.moves.length,
        updatedLinks: plan.updates.length,
        removedLinks: plan.deletes.length,
        relinkedContactId: plan.relinks.at(0) ?? null,
        foldedContactId: folded.at(0) ?? null,
      },
    });
  }

  /** Target patients must be visible and not merged away; returns the valid ids. */
  private checkTargetPatients(
    subjectId: string,
    requests: readonly LinkRequest[],
    locked: ReadonlyMap<string, DomainPatient>,
    issues: ValidationIssue[],
  ): string[] {
    const valid: string[] = [];
    for (const request of requests) {
      const patientId = targetPatientId(request.input.target);
      if (patientId === undefined) continue;
      if (patientId === subjectId) {
        throw new ContactIsPatientError('A patient cannot be their own contact');
      }
      const patient = locked.get(patientId);
      const path = joinPath(request.path, 'target.patientId');
      if (!patient) {
        issues.push({ path, code: 'not_found', message: 'Patient not found' });
      } else if (patient.mergedIntoId !== null) {
        issues.push({ path, code: 'merged', message: MERGED_TARGET });
      } else {
        valid.push(patientId);
      }
    }
    return valid;
  }

  /** Which contact `request` links; undefined (with an issue) when it cannot be resolved. */
  private resolve(
    subjectId: string,
    request: LinkRequest,
    locked: ReadonlyMap<string, DomainPatient>,
    byId: ReadonlyMap<string, ContactRecord>,
    byPatient: ReadonlyMap<string, ContactRecord>,
    tenant: Pick<Tenant, 'country'>,
    issues: ValidationIssue[],
  ): ResolvedLink | undefined {
    const { input, path } = request;
    const target = input.target;
    if ('contactId' in target) {
      const record = byId.get(target.contactId);
      if (!record) {
        issues.push({
          path: joinPath(path, 'target.contactId'),
          code: 'not_found',
          message: 'Contact not found',
        });
        return undefined;
      }
      assertNotOwnContact(subjectId, record.contact);
      const fullName = resolveContact(record.contact, record.linkedPatient).fullName;
      return { input, contact: { kind: 'existing', id: record.contact.id }, fullName };
    }
    if ('patientId' in target) {
      const patient = locked.get(target.patientId);
      if (!patient || patient.mergedIntoId !== null) return undefined;
      const record = byPatient.get(patient.id);
      return {
        input,
        contact: record
          ? { kind: 'existing', id: record.contact.id }
          : { kind: 'ofPatient', patientId: patient.id },
        fullName: patient.fullName,
      };
    }
    const phone = normalizePhone(target.newContact.phone, tenant.country);
    if (!phone) {
      issues.push({
        path: joinPath(path, 'target.newContact.phone'),
        code: 'invalid_phone',
        message: 'Not a valid phone number',
      });
      return undefined;
    }
    const row: NewContactRow = {
      fullName: target.newContact.fullName,
      phone,
      email: target.newContact.email,
    };
    return { input, contact: { kind: 'new', row }, fullName: row.fullName };
  }

  private async contactIdFor(link: ResolvedLink): Promise<string> {
    switch (link.contact.kind) {
      case 'existing':
        return link.contact.id;
      case 'ofPatient':
        return (await this.contacts.insertLinked(link.contact.patientId)).id;
      case 'new':
        return (await this.contacts.insert(link.contact.row)).id;
    }
  }

  /**
   * "The mother becomes a patient" (addendum C4): the unlinked `contact` (locked) is linked to
   * `patientId` and its own fields cleared. Audited as `contact.update` and announced as
   * `ContactUpdated`: everyone linking the contact now reads the patient's name and phone.
   */
  private async becomePatient(contact: DomainContact, patientId: string): Promise<void> {
    if (contact.linkedPatientId !== null) {
      throw new ContactAlreadyLinkedError('This contact is already a patient');
    }
    const linked = await this.contacts.linkToPatient(contact.id, patientId);
    if (!linked) throw new Error('linkToPatient: the locked contact was not updated');
    await this.audit.record({
      action: 'contact.update',
      resourceType: 'contact',
      resourceId: contact.id,
      before: {
        fullName: contact.fullName,
        phone: contact.phone,
        email: contact.email,
        linkedPatientId: null,
      },
      after: { fullName: null, phone: null, email: null, linkedPatientId: patientId },
    });
    const event: ContactUpdated = this.events.create(CONTACT_UPDATED, { contactId: contact.id });
    await this.events.publish(event);
  }
}

function issuesMessage(issues: readonly ValidationIssue[]): string {
  return issues.length === 1 ? '1 field is invalid' : `${issues.length} fields are invalid`;
}
