import { describe, expect, it } from 'vitest';
import { type FamilyPerson, possibleFamilies } from './family-suggestions';

const patient = (id: string, nameKey: string, phoneKey = '9613123456'): FamilyPerson => ({
  kind: 'patient',
  id,
  nameKey,
  phoneKey,
});
const contact = (id: string, nameKey: string, phoneKey = '9613123456'): FamilyPerson => ({
  kind: 'contact',
  id,
  nameKey,
  phoneKey,
});

const families = (
  people: FamilyPerson[],
  options: {
    links?: { patientId: string; contactId: string }[];
    contactOfPatient?: [string, string][];
    dismissals?: [string, string[]][];
  } = {},
) =>
  possibleFamilies({
    people,
    links: options.links ?? [],
    contactOfPatient: new Map(options.contactOfPatient ?? []),
    dismissals: new Map(
      (options.dismissals ?? []).map(([key, ids]) => [key, new Set(ids)] as const),
    ),
  }).map((group) => ({
    phoneKey: group.phoneKey,
    ids: group.people.map((person) => person.id),
    sameFamilyName: group.sameFamilyName,
  }));

describe('possibleFamilies', () => {
  it('groups people by phone key: two or more, at least one a patient', () => {
    expect(
      families([
        patient('p-lina', 'lina haddad'),
        patient('p-omar', 'omar haddad'),
        patient('p-solo', 'sami aoun', '9613000000'),
        contact('c-a', 'aya khoury', '9613999999'),
        contact('c-b', 'bilal khoury', '9613999999'),
      ]),
    ).toEqual([{ phoneKey: '9613123456', ids: ['p-lina', 'p-omar'], sameFamilyName: true }]);
  });

  it('puts a patient with a contact who is no patient, patients first', () => {
    expect(families([contact('c-mona', 'mona aoun'), patient('p-lina', 'lina haddad')])).toEqual([
      { phoneKey: '9613123456', ids: ['p-lina', 'c-mona'], sameFamilyName: false },
    ]);
  });

  it('leaves out a group already one family: directly linked', () => {
    expect(
      families([patient('p-lina', 'lina haddad'), contact('c-mona', 'mona haddad')], {
        links: [{ patientId: 'p-lina', contactId: 'c-mona' }],
      }),
    ).toEqual([]);
  });

  it('counts links through someone outside the group, and a patient as their own contact', () => {
    // Lina and Omar both link Mona, whose phone is another; Sami is the contact c-sami.
    const people = [
      patient('p-lina', 'lina haddad'),
      patient('p-omar', 'omar haddad'),
      patient('p-sami', 'sami haddad'),
    ];
    const links = [
      { patientId: 'p-lina', contactId: 'c-mona' },
      { patientId: 'p-omar', contactId: 'c-mona' },
      { patientId: 'p-lina', contactId: 'c-sami' },
    ];
    expect(families(people, { links, contactOfPatient: [['c-sami', 'p-sami']] })).toEqual([]);
    // Without Sami's own contact, Sami is not connected: the group shows, all three in it.
    expect(families(people, { links: links.slice(0, 2) })).toEqual([
      { phoneKey: '9613123456', ids: ['p-lina', 'p-omar', 'p-sami'], sameFamilyName: true },
    ]);
  });

  it('hides a dismissed group until someone new shares the phone', () => {
    const pair = [patient('p-lina', 'lina haddad'), patient('p-rana', 'rana aoun')];
    const dismissals: [string, string[]][] = [['9613123456', ['p-lina', 'p-rana']]];
    expect(families(pair, { dismissals })).toEqual([]);
    expect(families([...pair, contact('c-new', 'nadia aoun')], { dismissals })).toEqual([
      { phoneKey: '9613123456', ids: ['p-lina', 'p-rana', 'c-new'], sameFamilyName: false },
    ]);
  });

  it('orders same family name first, then larger groups, then by key', () => {
    const groups = families([
      patient('p-1', 'ali aoun', '1'),
      patient('p-2', 'rami saab', '1'),
      patient('p-3', 'hadi aoun', '1'),
      patient('p-4', 'lina haddad', '2'),
      patient('p-5', 'omar haddad', '2'),
      patient('p-6', 'jad saab', '3'),
      patient('p-7', 'tia khoury', '3'),
      patient('p-8', 'fadi nassar', '0'),
      patient('p-9', 'ziad karam', '0'),
    ]);
    expect(groups.map((group) => group.phoneKey)).toEqual(['2', '1', '0', '3']);
  });
});
