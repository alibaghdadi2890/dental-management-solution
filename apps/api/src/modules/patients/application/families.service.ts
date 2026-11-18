import {
  type ContactLinkPatch,
  type ContactLinkTarget,
  type FamilyDismissInput,
  type FamilyLinkInput,
  type FamilyLinkResult,
  type FamilySuggestion,
  storedPhone,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import {
  type ValidationIssue,
  ValidationFailedError,
} from '../../../platform/kernel/validation-failed.error';
import { AuditService } from '../../audit';
import { TenancyService } from '../../tenancy';
import { possibleFamilies } from '../domain/family-suggestions';
import { ContactsRepository } from '../persistence/contacts.repository';
import {
  type FamilyPersonRow,
  FamilySuggestionsRepository,
} from '../persistence/family-suggestions.repository';
import { PatientContactsRepository } from '../persistence/patient-contacts.repository';
import { PatientsRepository } from '../persistence/patients.repository';
import { ContactLinks } from './contact-links';
import { assertWritable, ContactsService } from './contacts.service';

/**
 * Possible families (families B, ADR-0093): people who share a phone and are not yet one family,
 * linking them in one go, and "Not a family".
 */
@Injectable()
export class FamiliesService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
    private readonly families: FamilySuggestionsRepository,
    private readonly patients: PatientsRepository,
    private readonly contacts: ContactsRepository,
    private readonly links: PatientContactsRepository,
    private readonly contactLinks: ContactLinks,
    private readonly contactsService: ContactsService,
  ) {}

  /** `GET /patients/families`: every possible family, same family name first (`possibleFamilies`). */
  async list(): Promise<FamilySuggestion[]> {
    this.context.requirePermission('patient:read');
    return this.tenantDb.run(async () => {
      const people = await this.families.sharedPhonePeople();
      const patientIds = people.flatMap((one) => (one.kind === 'patient' ? [one.id] : []));
      const contactIds = people.flatMap((one) => (one.kind === 'contact' ? [one.id] : []));
      const selfContacts = await this.families.contactsOfPatients(patientIds);
      const links = await this.families.linksTouching(patientIds, [
        ...contactIds,
        ...selfContacts.keys(),
      ]);
      const groups = possibleFamilies({
        people,
        links,
        contactOfPatient: selfContacts,
        dismissals: await this.families.dismissals(),
      });
      const rows = new Map(people.map((one) => [`${one.kind}:${one.id}`, one]));
      const selfOf = new Map(
        [...selfContacts].map(([contactId, patientId]) => [patientId, contactId]),
      );
      const contactsOf = (patientId: string) => [
        ...new Set(
          links.filter((link) => link.patientId === patientId).map((link) => link.contactId),
        ),
      ];
      return groups.map((group) => {
        const full = group.people.flatMap((one) => {
          const row = rows.get(`${one.kind}:${one.id}`);
          return row ? [row] : [];
        });
        const patients = full.filter((one) => one.kind === 'patient');
        return {
          phoneKey: group.phoneKey,
          phone: full[0]?.phone ?? '',
          sameFamilyName: group.sameFamilyName,
          patients: patients.map((one: FamilyPersonRow) => ({
            id: one.id,
            fullName: one.fullName,
            displayNumber: one.displayNumber ?? '',
            dateOfBirth: one.dateOfBirth,
            contactIds: contactsOf(one.id),
            selfContactId: selfOf.get(one.id) ?? null,
          })),
          contacts: full
            .filter((one) => one.kind === 'contact')
            .map((one) => ({ id: one.id, fullName: one.fullName })),
        };
      });
    });
  }

  /**
   * `POST /patients/families/link`: links every member to the payer in one transaction. The member
   * patients and a payer patient are locked first, in one statement (the lock order's level 1); a
   * new contact is created next; then each member is linked as `POST /patients/:id/contacts`
   * (`ContactLinks`), or — already linked to the payer — gets the ticked roles added. A billing
   * link becomes the member's primary billing contact. An unknown member or payer patient → 422 at
   * `members.<i>.patientId` / `payer.patientId`; an archived or merged member → 409.
   */
  async link(input: FamilyLinkInput): Promise<FamilyLinkResult> {
    this.context.requirePermission('patient:write');
    return this.tenantDb.run(async () => {
      const tenant = await this.tenancy.currentTenant();
      const payerPatientId = 'patientId' in input.payer ? input.payer.patientId : null;
      const ids = input.members.map((member) => member.patientId);
      const locked = new Map(
        (
          await this.patients.findByIdsForUpdate(payerPatientId ? [...ids, payerPatientId] : ids)
        ).map((patient) => [patient.id, patient]),
      );
      const issues: ValidationIssue[] = [];
      input.members.forEach((member, index) => {
        if (!locked.has(member.patientId)) {
          issues.push({
            path: `members.${String(index)}.patientId`,
            code: 'not_found',
            message: 'No such patient',
          });
        }
      });
      if (payerPatientId !== null && !locked.has(payerPatientId)) {
        issues.push({ path: 'payer.patientId', code: 'not_found', message: 'No such patient' });
      }
      if (issues.length > 0) throw new ValidationFailedError('Check the family', issues);
      for (const member of input.members) assertWritable(locked.get(member.patientId));

      let target: ContactLinkTarget;
      if ('newContact' in input.payer) {
        const { fullName, phone, email } = input.payer.newContact;
        const stored = storedPhone(phone, tenant.country);
        const created = await this.contacts.insert({ fullName, phone: stored, email });
        target = { contactId: created.id };
      } else {
        target = input.payer;
      }

      let linked = 0;
      for (const [index, member] of input.members.entries()) {
        const before = await this.payerContactId(target);
        const existing = before
          ? (await this.links.linksOf(member.patientId)).find((link) => link.contactId === before)
          : undefined;
        if (existing) {
          const patch: ContactLinkPatch = {};
          if (member.isGuardian && !existing.isGuardian) patch.isGuardian = true;
          if (member.isBillingContact && !existing.isBillingContact) patch.isBillingContact = true;
          if (Object.keys(patch).length > 0) {
            await this.contactsService.updateLink(member.patientId, existing.contactId, patch);
            linked += 1;
          }
        } else {
          await this.contactLinks.link(
            member.patientId,
            [
              {
                input: {
                  target,
                  relationship: member.relationship,
                  isGuardian: member.isGuardian,
                  isBillingContact: member.isBillingContact,
                  isEmergencyContact: false,
                },
                path: `members.${String(index)}`,
              },
            ],
            locked,
            tenant,
          );
          linked += 1;
        }
        if (member.isBillingContact) await this.makePrimaryBilling(member.patientId, target);
      }
      return { linked };
    });
  }

  /** `POST /patients/families/dismiss`: "Not a family", kept for the clinic (ADR-0093). */
  async dismiss(input: FamilyDismissInput): Promise<void> {
    this.context.requirePermission('patient:write');
    await this.tenantDb.run(async () => {
      const id = await this.families.saveDismissal(
        input.phoneKey,
        input.people,
        this.context.requireUserId(),
      );
      await this.audit.record({
        action: 'contact.family_dismiss',
        resourceType: 'family_dismissal',
        resourceId: id,
        after: { phoneKey: input.phoneKey, people: input.people },
      });
    });
  }

  /** The payer's contact id: the contact itself, or the contact that is the payer patient. */
  private async payerContactId(target: ContactLinkTarget): Promise<string | null> {
    if ('contactId' in target) return target.contactId;
    if ('patientId' in target) {
      return (await this.contacts.findByLinkedPatient(target.patientId))?.id ?? null;
    }
    return null;
  }

  private async makePrimaryBilling(patientId: string, target: ContactLinkTarget): Promise<void> {
    const contactId = await this.payerContactId(target);
    if (contactId === null) return;
    const link = (await this.links.linksOf(patientId)).find((row) => row.contactId === contactId);
    if (link && !link.isPrimaryBilling) {
      await this.contactsService.updateLink(patientId, contactId, { isPrimaryBilling: true });
    }
  }
}
