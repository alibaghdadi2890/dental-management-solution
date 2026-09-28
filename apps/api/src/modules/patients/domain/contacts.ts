import type { ContactRelationship, ContactView } from '@dcm/contracts';
import {
  ContactAlreadyLinkedError,
  ContactIsPatientError,
  ContactNotFoundError,
  ContactPrimaryWithoutRoleError,
  ContactRoleRequiredError,
} from './contact-errors';

/**
 * Contacts & family (design addendum C1–C8, ADR-0019): the rules for links between patients and
 * contacts — one primary per role, promotion, merge — and how a contact reads. Pure: the
 * repositories load the rows, these functions decide, and the repositories apply the result as
 * row writes in one transaction (CLAUDE.md §4 rule 5).
 */

/** A `contacts` row. A linked contact has no name, phone or e-mail of its own (C1). */
export interface DomainContact {
  id: string;
  fullName: string | null;
  /** `nameKey(fullName)`, for diacritics-insensitive lookup; null with `fullName`. */
  nameKey: string | null;
  /** E.164. */
  phone: string | null;
  /** E.164 digits + national digits, space-separated (as `patients.phone_search`). */
  phoneSearch: string | null;
  email: string | null;
  linkedPatientId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What a linked contact reads from its patient (C6, C9). */
export interface LinkedPatientFacts {
  id: string;
  displayNumber: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  deletedAt: Date | null;
}

export const CONTACT_ROLES = ['guardian', 'billing', 'emergency'] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export interface LinkRoles {
  isGuardian: boolean;
  isBillingContact: boolean;
  isEmergencyContact: boolean;
}

export interface LinkPrimaries {
  isPrimaryGuardian: boolean;
  isPrimaryBilling: boolean;
  isPrimaryEmergency: boolean;
}

/** The key of a `patient_contacts` row. */
export interface LinkKey {
  patientId: string;
  contactId: string;
}

/** A `patient_contacts` row as written: key, relationship, roles and primaries. */
export interface LinkState extends LinkKey, LinkRoles, LinkPrimaries {
  relationship: ContactRelationship;
}

/** A stored `patient_contacts` row; `createdAt` orders promotion (oldest holder first). */
export interface PatientLink extends LinkState {
  createdAt: Date;
}

const ROLE_REQUIRED = 'A contact needs at least one role';
const NOT_LINKED = 'This contact is not linked to the patient';

const ROLE_FLAG = {
  guardian: 'isGuardian',
  billing: 'isBillingContact',
  emergency: 'isEmergencyContact',
} as const satisfies Record<ContactRole, keyof LinkRoles>;

const PRIMARY_FLAG = {
  guardian: 'isPrimaryGuardian',
  billing: 'isPrimaryBilling',
  emergency: 'isPrimaryEmergency',
} as const satisfies Record<ContactRole, keyof LinkPrimaries>;

function holds(link: LinkRoles, role: ContactRole): boolean {
  return link[ROLE_FLAG[role]];
}

function hasRole(link: LinkRoles): boolean {
  return CONTACT_ROLES.some((role) => holds(link, role));
}

/** The contact currently primary for `role` among `links`, if any. */
function primaryOf(links: readonly LinkState[], role: ContactRole): string | undefined {
  return links.find((link) => link[PRIMARY_FLAG[role]])?.contactId;
}

function sameState(a: LinkState, b: LinkState): boolean {
  return (
    a.patientId === b.patientId &&
    a.contactId === b.contactId &&
    a.relationship === b.relationship &&
    CONTACT_ROLES.every(
      (role) =>
        a[ROLE_FLAG[role]] === b[ROLE_FLAG[role]] &&
        a[PRIMARY_FLAG[role]] === b[PRIMARY_FLAG[role]],
    )
  );
}

function stateOf(link: LinkState): LinkState {
  return {
    patientId: link.patientId,
    contactId: link.contactId,
    relationship: link.relationship,
    isGuardian: link.isGuardian,
    isBillingContact: link.isBillingContact,
    isEmergencyContact: link.isEmergencyContact,
    isPrimaryGuardian: link.isPrimaryGuardian,
    isPrimaryBilling: link.isPrimaryBilling,
    isPrimaryEmergency: link.isPrimaryEmergency,
  };
}

/** A link being planned: `createdAt` null for one not inserted yet (the newest). */
export type PlannedLink = LinkState & { createdAt: Date | null };

/** Oldest first; a link not yet inserted after every stored one; then by contact id. */
function byAge(a: PlannedLink, b: PlannedLink): number {
  const aTime = a.createdAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bTime = b.createdAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime < bTime ? -1 : 1;
  if (a.contactId === b.contactId) return 0;
  return a.contactId < b.contactId ? -1 : 1;
}

/** Candidate primaries per role, most preferred first (`undefined` entries are skipped). */
export type PrimaryPreference = Partial<Record<ContactRole, readonly (string | undefined)[]>>;

/**
 * Sets the primary flags of one patient's links (C2): for each role, the first candidate in
 * `preference[role]` that holds the role is its primary; failing that, the oldest holder (so the
 * first holder of a role becomes primary, and removing the primary promotes the oldest remaining
 * holder); a role without holders has no primary. The links' incoming primary flags are ignored:
 * callers pass the current primary as a candidate to keep it. Returns copies, in input order.
 */
export function assignPrimaries(
  links: readonly PlannedLink[],
  preference: PrimaryPreference,
): PlannedLink[] {
  const result = links.map((link) => ({ ...link }));
  for (const role of CONTACT_ROLES) {
    const holders = result.filter((link) => holds(link, role));
    const preferred = (preference[role] ?? []).find(
      (contactId) =>
        contactId !== undefined && holders.some((link) => link.contactId === contactId),
    );
    const primary = preferred ?? [...holders].sort(byAge).at(0)?.contactId;
    for (const link of result) link[PRIMARY_FLAG[role]] = link.contactId === primary;
  }
  return result;
}

/** One change to one patient's contacts (C5). Primaries are never set directly except here. */
export type LinkChange =
  | { kind: 'link'; contactId: string; relationship: ContactRelationship; roles: LinkRoles }
  | {
      kind: 'update';
      contactId: string;
      relationship?: ContactRelationship;
      roles?: Partial<LinkRoles>;
      /** Roles this contact becomes the primary of (it must hold them after the change). */
      makePrimary?: readonly ContactRole[];
    }
  | { kind: 'unlink'; contactId: string };

/**
 * The row writes for a `LinkChange`, applied in one transaction in this order (so the partial
 * unique "one primary per role" index never sees two primaries): delete `deletes`; clear the
 * primary flags of every row in `updates`; write `updates`; insert `inserts`.
 */
export interface LinkPlan {
  deletes: LinkKey[];
  /** Existing links whose state changes (full new state); unchanged links are left out. */
  updates: LinkState[];
  inserts: LinkState[];
}

/**
 * Plans a change to the links of patient `patientId`, given all of them (`existing`). Throws
 * `ContactAlreadyLinkedError` (link: already linked), `ContactNotFoundError` (update/unlink: not
 * linked), `ContactRoleRequiredError` (a link left without a role) and
 * `ContactPrimaryWithoutRoleError` (`makePrimary` for a role the contact does not hold).
 */
export function planLinkChange(
  patientId: string,
  existing: readonly PatientLink[],
  change: LinkChange,
): LinkPlan {
  const current = existing.find((link) => link.contactId === change.contactId);
  const preference: PrimaryPreference = {};
  for (const role of CONTACT_ROLES) preference[role] = [primaryOf(existing, role)];

  let next: PlannedLink[];
  const deletes: LinkKey[] = [];
  switch (change.kind) {
    case 'link': {
      if (current) throw new ContactAlreadyLinkedError('This contact is already linked');
      if (!hasRole(change.roles)) throw new ContactRoleRequiredError(ROLE_REQUIRED);
      next = [
        ...existing,
        {
          patientId,
          contactId: change.contactId,
          relationship: change.relationship,
          ...change.roles,
          isPrimaryGuardian: false,
          isPrimaryBilling: false,
          isPrimaryEmergency: false,
          createdAt: null,
        },
      ];
      break;
    }
    case 'update': {
      if (!current) throw new ContactNotFoundError(NOT_LINKED);
      const updated: PlannedLink = {
        ...current,
        relationship: change.relationship ?? current.relationship,
        isGuardian: change.roles?.isGuardian ?? current.isGuardian,
        isBillingContact: change.roles?.isBillingContact ?? current.isBillingContact,
        isEmergencyContact: change.roles?.isEmergencyContact ?? current.isEmergencyContact,
      };
      if (!hasRole(updated)) throw new ContactRoleRequiredError(ROLE_REQUIRED);
      for (const role of change.makePrimary ?? []) {
        if (!holds(updated, role)) {
          throw new ContactPrimaryWithoutRoleError('A primary contact must hold the role');
        }
        preference[role] = [change.contactId];
      }
      next = existing.map((link) => (link.contactId === change.contactId ? updated : link));
      break;
    }
    case 'unlink': {
      if (!current) throw new ContactNotFoundError(NOT_LINKED);
      next = existing.filter((link) => link.contactId !== change.contactId);
      deletes.push({ patientId, contactId: change.contactId });
      break;
    }
  }

  const assigned = assignPrimaries(next, preference);
  const before = new Map(existing.map((link) => [link.contactId, link]));
  const updates: LinkState[] = [];
  const inserts: LinkState[] = [];
  for (const link of assigned) {
    const previous = before.get(link.contactId);
    if (!previous) inserts.push(stateOf(link));
    else if (!sameState(previous, link)) updates.push(stateOf(link));
  }
  return { deletes, updates, inserts };
}

/** A contact linked to a patient, with every link it has (on any patient). */
export interface LinkedContactLinks {
  contactId: string;
  links: readonly PatientLink[];
}

export interface ContactMergeInput {
  keptId: string;
  droppedId: string;
  /** Every link of the kept patient. */
  keptLinks: readonly PatientLink[];
  /** Every link of the dropped patient. */
  droppedLinks: readonly PatientLink[];
  /** The live contact linked to the dropped patient, if any (at most one: unique index). */
  droppedLinkedContact: LinkedContactLinks | null;
  /** The live contact linked to the kept patient, if any. */
  keptLinkedContact: LinkedContactLinks | null;
}

/** `from` is folded into `into`: `repoints` (links of `from`) change contact; `from` is deleted. */
export interface ContactFold {
  fromContactId: string;
  intoContactId: string;
  repoints: LinkKey[];
}

/**
 * The row writes of a merge's contacts (C8), applied in one transaction in this order: delete
 * `deletes`; clear the primary flags of every row in `updates` and of each `moves` row (still on
 * the dropped patient); write `updates`; move each `moves` row to the kept patient (`patientId`)
 * with its state; re-point each fold's `repoints` to `intoContactId`; set `linked_patient_id` to
 * the kept patient on `relinks`; soft-delete each fold's `fromContactId`.
 */
export interface ContactMergePlan {
  deletes: LinkKey[];
  updates: LinkState[];
  /** Links of the dropped patient moving to the kept one (`patientId` is the kept id). */
  moves: LinkState[];
  relinks: string[];
  folds: ContactFold[];
}

function orRoles<T extends LinkState>(into: T, from: LinkRoles): T {
  return {
    ...into,
    isGuardian: into.isGuardian || from.isGuardian,
    isBillingContact: into.isBillingContact || from.isBillingContact,
    isEmergencyContact: into.isEmergencyContact || from.isEmergencyContact,
  };
}

/**
 * Plans the contacts side of merging `droppedId` into `keptId` (C8):
 * - the dropped patient's links move to the kept patient; for a contact on both, roles are OR-ed
 *   and the kept link (relationship, creation time) stays. Primaries per role: the kept record's,
 *   else the dropped record's, else the oldest holder (`assignPrimaries`);
 * - links that would make the kept patient its own contact (to the contact linked to the kept or
 *   the dropped patient) are deleted, on both lists;
 * - the contact linked to the dropped patient is re-pointed to the kept one (`relinks`), or,
 *   when the kept patient already has a linked contact, folded into it: its links on other
 *   patients move to that contact (a patient linked to both keeps one link, roles and primaries
 *   OR-ed — they are the same person, and one patient has at most one primary per role, so the
 *   OR never makes two) and it is deleted.
 */
export function planContactMerge(input: ContactMergeInput): ContactMergePlan {
  const { keptId, droppedId } = input;
  const droppedSelf = input.droppedLinkedContact;
  const keptSelf = input.keptLinkedContact;
  const own = new Set<string>();
  if (droppedSelf) own.add(droppedSelf.contactId);
  if (keptSelf) own.add(keptSelf.contactId);

  const deletes: LinkKey[] = [];
  const final = new Map<string, PlannedLink>();
  for (const link of input.keptLinks) {
    if (own.has(link.contactId)) deletes.push({ patientId: keptId, contactId: link.contactId });
    else final.set(link.contactId, link);
  }
  const moving = new Set<string>();
  for (const link of input.droppedLinks) {
    const onKept = final.get(link.contactId);
    if (own.has(link.contactId) || onKept) {
      deletes.push({ patientId: droppedId, contactId: link.contactId });
      if (onKept) final.set(link.contactId, orRoles(onKept, link));
    } else {
      final.set(link.contactId, { ...link, patientId: keptId });
      moving.add(link.contactId);
    }
  }

  const preference: PrimaryPreference = {};
  for (const role of CONTACT_ROLES) {
    preference[role] = [primaryOf(input.keptLinks, role), primaryOf(input.droppedLinks, role)];
  }
  const keptBefore = new Map(input.keptLinks.map((link) => [link.contactId, link]));
  const updates: LinkState[] = [];
  const moves: LinkState[] = [];
  for (const link of assignPrimaries([...final.values()], preference)) {
    if (moving.has(link.contactId)) moves.push(stateOf(link));
    else {
      const before = keptBefore.get(link.contactId);
      if (before && !sameState(before, link)) updates.push(stateOf(link));
    }
  }

  const relinks: string[] = [];
  const folds: ContactFold[] = [];
  if (droppedSelf && !keptSelf) relinks.push(droppedSelf.contactId);
  if (droppedSelf && keptSelf) {
    const onOthers = (link: PatientLink) =>
      link.patientId !== keptId && link.patientId !== droppedId;
    const intoByPatient = new Map(
      keptSelf.links.filter(onOthers).map((link) => [link.patientId, link]),
    );
    const repoints: LinkKey[] = [];
    for (const link of droppedSelf.links.filter(onOthers)) {
      const into = intoByPatient.get(link.patientId);
      if (!into) {
        repoints.push({ patientId: link.patientId, contactId: droppedSelf.contactId });
        continue;
      }
      deletes.push({ patientId: link.patientId, contactId: droppedSelf.contactId });
      const merged: LinkState = {
        ...orRoles(stateOf(into), link),
        isPrimaryGuardian: into.isPrimaryGuardian || link.isPrimaryGuardian,
        isPrimaryBilling: into.isPrimaryBilling || link.isPrimaryBilling,
        isPrimaryEmergency: into.isPrimaryEmergency || link.isPrimaryEmergency,
      };
      if (!sameState(into, merged)) updates.push(merged);
    }
    folds.push({
      fromContactId: droppedSelf.contactId,
      intoContactId: keptSelf.contactId,
      repoints,
    });
  }

  return { deletes, updates, moves, relinks, folds };
}

/**
 * How a contact reads (C6): a linked contact shows its patient's name, phone and e-mail, and
 * still resolves when that patient is archived (C9). Throws when a linked contact's patient is
 * not supplied: the repository always loads it (same tenant, foreign key).
 */
export function resolveContact(
  contact: DomainContact,
  linkedPatient: LinkedPatientFacts | null = null,
): ContactView {
  if (contact.linkedPatientId === null) {
    if (contact.fullName === null) throw new Error(`contact ${contact.id} has no name`);
    return {
      id: contact.id,
      fullName: contact.fullName,
      phone: contact.phone,
      email: contact.email,
      linkedPatient: null,
    };
  }
  if (linkedPatient?.id !== contact.linkedPatientId) {
    throw new Error(`contact ${contact.id}: the linked patient was not loaded`);
  }
  return {
    id: contact.id,
    fullName: linkedPatient.fullName,
    phone: linkedPatient.phone,
    email: linkedPatient.email,
    linkedPatient: {
      id: linkedPatient.id,
      displayNumber: linkedPatient.displayNumber,
      archived: linkedPatient.deletedAt !== null,
    },
  };
}

/** True when `contact` is the patient `patientId` itself (C2: never their own contact). */
export function isOwnContact(
  patientId: string,
  contact: { linkedPatientId: string | null },
): boolean {
  return contact.linkedPatientId === patientId;
}

/** Throws `ContactIsPatientError` when linking `contact` would make the patient its own contact. */
export function assertNotOwnContact(
  patientId: string,
  contact: { linkedPatientId: string | null },
): void {
  if (isOwnContact(patientId, contact)) {
    throw new ContactIsPatientError('A patient cannot be their own contact');
  }
}
