/**
 * Possible families (families B, ADR-0093): people who share a phone and are not yet linked into
 * one family. Pure.
 */

/** An active patient with a phone, or a live contact who is no patient with a phone. */
export interface FamilyPerson {
  kind: 'patient' | 'contact';
  id: string;
  /** `nameKey(fullName)`: diacritics-insensitive, lower case, single spaces. */
  nameKey: string;
  /** The digits of the stored phone (the first word of `phone_search`). */
  phoneKey: string;
}

export interface FamilyGroup {
  phoneKey: string;
  /** Patients first, then contacts, each by name key. */
  people: FamilyPerson[];
  /** Every person's last name word is the same. */
  sameFamilyName: boolean;
}

export interface FamilyInput {
  people: readonly FamilyPerson[];
  /** Contact links touching any of `people` (a patient's links, a contact's links). */
  links: readonly { patientId: string; contactId: string }[];
  /** Contacts that are patients: contact id → that patient's id (one person). */
  contactOfPatient: ReadonlyMap<string, string>;
  /** "Not a family" answers: phone key → the people it was answered for. */
  dismissals: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * The groups of two or more people, at least one a patient, sharing a phone key, who are not
 * already one family — every one connected to the others through links, a contact who is a
 * patient being that patient, through anyone (inside the group or not). A group answered "Not a
 * family" stays hidden while all its people are among those answered for. Same family name first,
 * then larger groups, then by key.
 */
export function possibleFamilies(input: FamilyInput): FamilyGroup[] {
  const parent = new Map<string, string>();
  const find = (node: string): string => {
    let root = node;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root) ?? root;
    parent.set(node, root);
    return root;
  };
  const person = (id: string) => input.contactOfPatient.get(id) ?? id;
  for (const link of input.links) {
    const a = find(link.patientId);
    const b = find(person(link.contactId));
    if (a !== b) parent.set(a, b);
  }

  const byKey = new Map<string, FamilyPerson[]>();
  for (const one of input.people) {
    byKey.set(one.phoneKey, [...(byKey.get(one.phoneKey) ?? []), one]);
  }

  const groups: FamilyGroup[] = [];
  for (const [phoneKey, people] of byKey) {
    if (people.length < 2 || !people.some((one) => one.kind === 'patient')) continue;
    const roots = new Set(people.map((one) => find(person(one.id))));
    if (roots.size === 1) continue;
    const dismissed = input.dismissals.get(phoneKey);
    if (dismissed && people.every((one) => dismissed.has(one.id))) continue;
    const lastNames = new Set(people.map((one) => one.nameKey.split(' ').at(-1) ?? ''));
    groups.push({
      phoneKey,
      people: [...people].sort(
        (a, b) =>
          (a.kind === b.kind ? 0 : a.kind === 'patient' ? -1 : 1) ||
          compare(a.nameKey, b.nameKey) ||
          compare(a.id, b.id),
      ),
      sameFamilyName: lastNames.size === 1 && !lastNames.has(''),
    });
  }
  return groups.sort(
    (a, b) =>
      Number(b.sameFamilyName) - Number(a.sameFamilyName) ||
      b.people.length - a.people.length ||
      compare(a.phoneKey, b.phoneKey),
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
