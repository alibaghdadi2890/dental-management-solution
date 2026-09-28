import { describe, expect, it, vi } from 'vitest';
import type { EventBus } from '../../../platform/events/event-bus';
import type { Clock } from '../../../platform/kernel/clock';
import type { AuditService } from '../../audit';
import { ContactConflictError } from '../domain/contact-errors';
import type { DomainContact, PatientLink } from '../domain/contacts';
import type { ContactsRepository } from '../persistence/contacts.repository';
import type { PatientContactsRepository } from '../persistence/patient-contacts.repository';
import type { PatientsRepository } from '../persistence/patients.repository';
import { ContactLinks } from './contact-links';

const AT = new Date('2026-09-28T10:00:00Z');

function contact(id: string, linkedPatientId: string): DomainContact {
  return {
    id,
    fullName: null,
    nameKey: null,
    phone: null,
    phoneSearch: null,
    email: null,
    linkedPatientId,
    deletedAt: null,
    createdAt: AT,
    updatedAt: AT,
  };
}

function link(patientId: string, contactId: string): PatientLink {
  return {
    patientId,
    contactId,
    relationship: 'parent',
    isGuardian: true,
    isBillingContact: false,
    isEmergencyContact: false,
    isPrimaryGuardian: true,
    isPrimaryBilling: false,
    isPrimaryEmergency: false,
    createdAt: AT,
  };
}

/**
 * The kept (`k`) and dropped (`d`) patients are both someone's contact (`ck`, `cd`), so the merge
 * folds `cd` into `ck`; `cd` is linked on the child `z`.
 */
function setup(droppedContactLinks: PatientLink[]) {
  const contacts = {
    linkedToPatientsForUpdate: vi.fn(() =>
      Promise.resolve([contact('ck', 'k'), contact('cd', 'd')]),
    ),
    relink: vi.fn(() => Promise.resolve()),
    softDelete: vi.fn(() => Promise.resolve()),
  };
  const links = {
    linksOfForUpdate: vi.fn(() => Promise.resolve([])),
    listForContactForUpdate: vi.fn(() => Promise.resolve(droppedContactLinks)),
    listForContact: vi.fn(() => Promise.resolve([])),
    applyMergePlan: vi.fn(() => Promise.resolve()),
  };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const events = { create: vi.fn(), publish: vi.fn(() => Promise.resolve()) };
  const service = new ContactLinks(
    events as unknown as EventBus,
    audit as unknown as AuditService,
    {} as PatientsRepository,
    contacts as unknown as ContactsRepository,
    links as unknown as PatientContactsRepository,
    { now: () => AT } satisfies Clock,
  );
  return { service, contacts, links, audit, events };
}

describe('ContactLinks.mergeContacts', () => {
  it('refuses a fold that would rewrite links of a patient the merge did not lock', async () => {
    const { service, contacts, links, audit, events } = setup([link('z', 'cd')]);
    const merge = service.mergeContacts('k', 'd', new Set(['k', 'd']));
    await expect(merge).rejects.toBeInstanceOf(ContactConflictError);
    await expect(merge).rejects.toMatchObject({ code: 'contact.conflict' });
    expect(links.applyMergePlan).not.toHaveBeenCalled();
    expect(contacts.relink).not.toHaveBeenCalled();
    expect(contacts.softDelete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('folds when every patient it rewrites is locked', async () => {
    const { service, contacts, links } = setup([link('z', 'cd')]);
    await service.mergeContacts('k', 'd', new Set(['k', 'd', 'z']));
    expect(links.applyMergePlan).toHaveBeenCalledWith('d', {
      deletes: [],
      updates: [],
      moves: [],
      relinks: [],
      folds: [
        {
          fromContactId: 'cd',
          intoContactId: 'ck',
          repoints: [{ patientId: 'z', contactId: 'cd' }],
        },
      ],
    });
    expect(contacts.softDelete).toHaveBeenCalledWith(['cd'], AT);
  });
});
