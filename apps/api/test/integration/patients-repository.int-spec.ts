import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planLinkChange } from '../../src/modules/patients/domain/contacts';
import { PatientNotFoundError } from '../../src/modules/patients/domain/patient-errors';
import { ContactsRepository } from '../../src/modules/patients/persistence/contacts.repository';
import { PatientContactsRepository } from '../../src/modules/patients/persistence/patient-contacts.repository';
import { PatientCountersRepository } from '../../src/modules/patients/persistence/patient-counters.repository';
import {
  type NewPatient,
  type NormalizedPhoneInput,
  PatientsRepository,
} from '../../src/modules/patients/persistence/patients.repository';
import { type ContextSeed, RequestContext } from '../../src/platform/cls/request-context';
import { TenantDb } from '../../src/platform/db/tenant-db';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createTestApp, type TestApp } from '../support/test-app';

const PHONE = (e164: string, national: string): NormalizedPhoneInput => ({ e164, national });

/** Unique enough for these tests: uniqueness only needs to hold within a tenant. */
let displayNumberCounter = 0;
function nextDisplayNumber(): string {
  displayNumberCounter += 1;
  return `P-${String(displayNumberCounter).padStart(6, '0')}`;
}

function newPatient(overrides: Partial<NewPatient> = {}): NewPatient {
  return {
    displayNumber: nextDisplayNumber(),
    fullName: 'Test Patient',
    phone: PHONE('+96100000000', '00000000'),
    dateOfBirth: null,
    sex: 'unknown',
    email: null,
    address: null,
    insurance: null,
    notes: null,
    medicalAlerts: [],
    primaryDentistId: null,
    externalId: null,
    idempotency: null,
    ...overrides,
  };
}

describe('patients: repositories', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let context: RequestContext;
  let tenantDb: TenantDb;
  let repo: PatientsRepository;
  let counters: PatientCountersRepository;
  let contactsRepo: ContactsRepository;
  let links: PatientContactsRepository;

  const seed = (tenantId: string, extra: Partial<ContextSeed> = {}): ContextSeed => ({
    requestId: `req-${newId()}`,
    actorKind: 'user',
    tenantId,
    userId: newId(),
    ...extra,
  });
  const inTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
    context.run(seed(tenantId), fn);
  /** Runs `fn` inside an open transaction in `tenantId` — required by `lockPair`. */
  const inTenantTx = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
    inTenant(tenantId, () => tenantDb.run(fn));
  const create = (tenantId: string, overrides: Partial<NewPatient> = {}) =>
    inTenant(tenantId, () => repo.insert(newPatient(overrides)));

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    context = testApp.app.get(RequestContext);
    tenantDb = testApp.app.get(TenantDb);
    repo = testApp.app.get(PatientsRepository);
    counters = testApp.app.get(PatientCountersRepository);
    contactsRepo = testApp.app.get(ContactsRepository);
    links = testApp.app.get(PatientContactsRepository);
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('PatientCountersRepository.nextValue', () => {
    it('increments 1, 2, 3 within a tenant', async () => {
      const tenant = newId();
      expect(await inTenant(tenant, () => counters.nextValue())).toBe(1);
      expect(await inTenant(tenant, () => counters.nextValue())).toBe(2);
      expect(await inTenant(tenant, () => counters.nextValue())).toBe(3);
    });

    it('counts independently per tenant', async () => {
      const tenantA = newId();
      const tenantB = newId();
      expect(await inTenant(tenantA, () => counters.nextValue())).toBe(1);
      expect(await inTenant(tenantA, () => counters.nextValue())).toBe(2);
      expect(await inTenant(tenantB, () => counters.nextValue())).toBe(1);
    });

    it('gives 10 concurrent calls distinct, consecutive values', async () => {
      const tenant = newId();
      const results = await Promise.all(
        Array.from({ length: 10 }, () => inTenant(tenant, () => counters.nextValue())),
      );
      expect([...results].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
  });

  describe('search: q', () => {
    const tenant = newId();
    let jose: string;
    let percent: string;
    let underscoreId: string;
    let backslashId: string;

    beforeAll(async () => {
      jose = (
        await create(tenant, {
          displayNumber: 'P-000001',
          fullName: 'José Álvarez',
          phone: PHONE('+9613123456', '03123456'),
        })
      ).id;
      await create(tenant, {
        displayNumber: 'P-000002',
        fullName: 'Amira Khalil',
        phone: PHONE('+9611234567', '01234567'),
        email: 'unique-mailbox@example.com',
      });
      percent = (
        await create(tenant, {
          displayNumber: 'P-000003',
          fullName: 'Percent Test',
          email: 'a%b@example.com',
        })
      ).id;
      underscoreId = (
        await create(tenant, {
          displayNumber: 'P-000004',
          fullName: 'Underscore Test',
          email: 'a_b@example.com',
        })
      ).id;
      backslashId = (
        await create(tenant, {
          displayNumber: 'P-000005',
          fullName: 'Backslash Test',
          email: String.raw`a\b@example.com`,
        })
      ).id;
    });

    const q = (query: string) =>
      inTenant(tenant, () =>
        repo.search({ view: 'active', q: query }, { page: 1, size: 50, sort: 'name', dir: 'asc' }),
      );

    it('matches the name diacritics- and case-insensitively', async () => {
      const { rows } = await q('jose');
      expect(rows.map((r) => r.id)).toContain(jose);
      expect((await q('JOSÉ')).rows.map((r) => r.id)).toContain(jose);
    });

    it('matches the display number', async () => {
      const { rows } = await q('P-000001');
      expect(rows.map((r) => r.id)).toEqual([jose]);
    });

    it('matches the e-mail', async () => {
      const { rows } = await q('unique-mailbox');
      expect(rows.map((r) => r.fullName)).toEqual(['Amira Khalil']);
    });

    it('matches phone digits typed in local national form', async () => {
      const { rows } = await q('03123');
      expect(rows.map((r) => r.id)).toContain(jose);
    });

    it('matches phone digits typed in E.164 form', async () => {
      const { rows } = await q('96131');
      expect(rows.map((r) => r.id)).toContain(jose);
    });

    it('matches a patient number against display numbers only, never phone digits', async () => {
      const phoneTwin = (
        await create(tenant, {
          displayNumber: 'P-000070',
          fullName: 'Number Lookalike',
          phone: PHONE('+96170000002', '70000002'),
        })
      ).id;
      for (const number of ['P-000002', 'p-000002', 'P000002']) {
        const { rows } = await q(number);
        expect(rows.map((r) => r.fullName)).toEqual(['Amira Khalil']);
      }
      // Bare digits are still a phone query.
      expect((await q('000002')).rows.map((r) => r.id)).toContain(phoneTwin);
    });

    it('stores a patient without a phone, whom a digit query never matches by phone', async () => {
      const phoneless = await create(tenant, {
        displayNumber: 'P-000080',
        fullName: 'Phoneless Minor',
        phone: null,
        dateOfBirth: '2020-01-01',
      });
      expect(phoneless).toMatchObject({ phone: null, phoneSearch: null });
      const stored = await database.ownerPool.query<{ phone: null; phone_search: null }>(
        'select phone, phone_search from patients where id = $1',
        [phoneless.id],
      );
      expect(stored.rows).toEqual([{ phone: null, phone_search: null }]);
      // Digits that match other patients' phones leave the phoneless one out, without failing.
      const byDigits = (await q('03123')).rows.map((r) => r.id);
      expect(byDigits).toContain(jose);
      expect(byDigits).not.toContain(phoneless.id);
      // The name and the number still find them.
      expect((await q('phoneless')).rows.map((r) => r.id)).toEqual([phoneless.id]);
      expect((await q('P-000080')).rows.map((r) => r.id)).toEqual([phoneless.id]);
    });

    it('does not match phone digits when the query is a single digit', async () => {
      const { rows } = await q('7');
      expect(rows.map((r) => r.id)).not.toContain(jose);
    });

    it('treats a literal "%" in the query as a literal character, not a wildcard', async () => {
      const { rows } = await q('a%b');
      expect(rows.map((r) => r.id)).toEqual([percent]);
    });

    it('treats a literal "_" in the query as a literal character, not a single-char wildcard', async () => {
      const { rows } = await q('a_b');
      expect(rows.map((r) => r.id)).toEqual([underscoreId]);
    });

    it('treats a literal "\\" in the query as a literal character', async () => {
      const { rows } = await q(String.raw`a\b`);
      expect(rows.map((r) => r.id)).toEqual([backslashId]);
    });
  });

  describe('update', () => {
    it('re-derives name_key and phone_search, so search finds the new value and not the old', async () => {
      const tenant = newId();
      const patient = await create(tenant, {
        fullName: 'Original Name',
        phone: PHONE('+9613111111', '03111111'),
      });

      await inTenant(tenant, () =>
        repo.update(patient.id, {
          fullName: 'Renamed Person',
          phone: PHONE('+9613222222', '03222222'),
        }),
      );

      const byNewName = await inTenant(tenant, () =>
        repo.search(
          { view: 'active', q: 'Renamed' },
          { page: 1, size: 10, sort: 'name', dir: 'asc' },
        ),
      );
      expect(byNewName.rows.map((r) => r.id)).toContain(patient.id);

      const byOldName = await inTenant(tenant, () =>
        repo.search(
          { view: 'active', q: 'Original' },
          { page: 1, size: 10, sort: 'name', dir: 'asc' },
        ),
      );
      expect(byOldName.rows.map((r) => r.id)).not.toContain(patient.id);

      const byNewPhone = await inTenant(tenant, () =>
        repo.search(
          { view: 'active', q: '03222222' },
          { page: 1, size: 10, sort: 'name', dir: 'asc' },
        ),
      );
      expect(byNewPhone.rows.map((r) => r.id)).toContain(patient.id);

      const byOldPhone = await inTenant(tenant, () =>
        repo.search(
          { view: 'active', q: '03111111' },
          { page: 1, size: 10, sort: 'name', dir: 'asc' },
        ),
      );
      expect(byOldPhone.rows.map((r) => r.id)).not.toContain(patient.id);
    });

    it('clears the phone and its search digits together', async () => {
      const tenant = newId();
      const patient = await create(tenant, { phone: PHONE('+9613444444', '03444444') });
      const cleared = await inTenant(tenant, () => repo.update(patient.id, { phone: null }));
      expect(cleared).toMatchObject({ phone: null, phoneSearch: null });
      const byOldPhone = await inTenant(tenant, () =>
        repo.search(
          { view: 'active', q: '03444444' },
          { page: 1, size: 10, sort: 'name', dir: 'asc' },
        ),
      );
      expect(byOldPhone.rows).toEqual([]);
    });
  });

  describe('search: view', () => {
    it('active excludes archived rows; archived includes only archived rows', async () => {
      const tenant = newId();
      const active = await create(tenant, { fullName: 'Active Patient' });
      const archived = await create(tenant, { fullName: 'Archived Patient' });
      await inTenant(tenant, () => repo.setArchived([archived.id], new Date()));

      const activeView = await inTenant(tenant, () =>
        repo.search({ view: 'active' }, { page: 1, size: 50, sort: 'name', dir: 'asc' }),
      );
      expect(activeView.rows.map((r) => r.id)).toContain(active.id);
      expect(activeView.rows.map((r) => r.id)).not.toContain(archived.id);

      const archivedView = await inTenant(tenant, () =>
        repo.search({ view: 'archived' }, { page: 1, size: 50, sort: 'name', dir: 'asc' }),
      );
      expect(archivedView.rows.map((r) => r.id)).toContain(archived.id);
      expect(archivedView.rows.map((r) => r.id)).not.toContain(active.id);
    });
  });

  describe('search: filters', () => {
    const tenant = newId();
    let dentistA: string;
    let dentistB: string;
    let withDentistA: string;
    let noDentist: string;
    let withAlerts: string;
    let withoutAlerts: string;
    let youngPatient: string;
    let oldPatient: string;

    beforeAll(async () => {
      dentistA = newId();
      dentistB = newId();
      withDentistA = (await create(tenant, { primaryDentistId: dentistA })).id;
      await create(tenant, { primaryDentistId: dentistB });
      noDentist = (await create(tenant, { primaryDentistId: null })).id;
      withAlerts = (await create(tenant, { medicalAlerts: ['Penicillin'] })).id;
      withoutAlerts = (await create(tenant, { medicalAlerts: [] })).id;
      youngPatient = (await create(tenant, { dateOfBirth: '2020-01-01' })).id;
      oldPatient = (await create(tenant, { dateOfBirth: '1950-01-01' })).id;
    });

    const search = (filters: Parameters<PatientsRepository['search']>[0]) =>
      inTenant(tenant, () => repo.search(filters, { page: 1, size: 50, sort: 'name', dir: 'asc' }));

    it('filters by dentist id', async () => {
      const { rows } = await search({ view: 'active', dentist: dentistA });
      expect(rows.map((r) => r.id)).toEqual([withDentistA]);
    });

    it('filters by "no dentist"', async () => {
      const { rows } = await search({ view: 'active', dentist: 'none' });
      expect(rows.map((r) => r.id)).toContain(noDentist);
      expect(rows.map((r) => r.id)).not.toContain(withDentistA);
    });

    it('filters by alerts yes/no', async () => {
      expect((await search({ view: 'active', alerts: 'yes' })).rows.map((r) => r.id)).toContain(
        withAlerts,
      );
      expect((await search({ view: 'active', alerts: 'no' })).rows.map((r) => r.id)).not.toContain(
        withAlerts,
      );
      expect((await search({ view: 'active', alerts: 'no' })).rows.map((r) => r.id)).toContain(
        withoutAlerts,
      );
    });

    it('filters by date-of-birth bounds', async () => {
      const { rows } = await search({ view: 'active', dobAfter: '2000-01-01' });
      expect(rows.map((r) => r.id)).toContain(youngPatient);
      expect(rows.map((r) => r.id)).not.toContain(oldPatient);

      const { rows: older } = await search({ view: 'active', dobOnOrBefore: '2000-01-01' });
      expect(older.map((r) => r.id)).toContain(oldPatient);
      expect(older.map((r) => r.id)).not.toContain(youngPatient);
    });
  });

  describe('search: sort, rank, pagination, idsIn', () => {
    const tenant = newId();
    let alice: string;
    let bob: string;
    let carol: string; // no date of birth

    beforeAll(async () => {
      alice = (await create(tenant, { fullName: 'Alice Young', dateOfBirth: '2015-01-01' })).id;
      bob = (await create(tenant, { fullName: 'Bob Old', dateOfBirth: '1950-01-01' })).id;
      carol = (await create(tenant, { fullName: 'Carol NoDob', dateOfBirth: null })).id;
    });

    it('sorts by name', async () => {
      const { rows } = await inTenant(tenant, () =>
        repo.search({ view: 'active' }, { page: 1, size: 50, sort: 'name', dir: 'asc' }),
      );
      const names = rows.map((r) => r.fullName);
      expect(names.indexOf('Alice Young')).toBeLessThan(names.indexOf('Bob Old'));
      expect(names.indexOf('Bob Old')).toBeLessThan(names.indexOf('Carol NoDob'));
    });

    it('sorts by age with nulls last in both directions', async () => {
      const ascending = await inTenant(tenant, () =>
        repo.search({ view: 'active' }, { page: 1, size: 50, sort: 'age', dir: 'asc' }),
      );
      // dir=asc means youngest (most recent dob) first; the null-dob patient always trails.
      const ascIds = ascending.rows.map((r) => r.id);
      expect(ascIds.indexOf(alice)).toBeLessThan(ascIds.indexOf(bob));
      expect(ascIds.indexOf(carol)).toBe(ascIds.length - 1);

      const descending = await inTenant(tenant, () =>
        repo.search({ view: 'active' }, { page: 1, size: 50, sort: 'age', dir: 'desc' }),
      );
      const descIds = descending.rows.map((r) => r.id);
      expect(descIds.indexOf(bob)).toBeLessThan(descIds.indexOf(alice));
      expect(descIds.indexOf(carol)).toBe(descIds.length - 1);
    });

    it('sorts by recently updated, most recent first, regardless of dir', async () => {
      // Touch all three via the application clock (`$onUpdate`), in name order, so their relative
      // order never depends on comparing against a bare `created_at` (which comes from Postgres'
      // own clock, `defaultNow()`, and can drift from the application clock — e.g. Docker Desktop
      // on Windows — enough to flip an otherwise-correct ordering). The expected result is the
      // *reverse* of touch order: whichever was touched last sorts first.
      await inTenant(tenant, () => repo.update(alice, { notes: 'touched 1st' }));
      await inTenant(tenant, () => repo.update(bob, { notes: 'touched 2nd' }));
      await inTenant(tenant, () => repo.update(carol, { notes: 'touched 3rd, most recent' }));
      const { rows } = await inTenant(tenant, () =>
        repo.search({ view: 'active' }, { page: 1, size: 50, sort: 'recent', dir: 'asc' }),
      );
      expect(rows.map((r) => r.id)).toEqual([carol, bob, alice]);
    });

    const byRank = (rank: { ids: string[]; keys: number[]; restKey: number }) =>
      inTenant(tenant, () =>
        repo.search(
          { view: 'active' },
          { page: 1, size: 50, sort: 'balance', dir: 'desc', rank: { column: 'id', ...rank } },
        ),
      );

    it('orders by rank key (column: id), unlisted rows at restKey', async () => {
      const { rows } = await byRank({ ids: [bob, alice], keys: [1, 2], restKey: 3 });
      expect(rows.map((r) => r.id)).toEqual([bob, alice, carol]);

      const restFirst = await byRank({ ids: [bob, alice], keys: [2, 3], restKey: 1 });
      expect(restFirst.rows.map((r) => r.id)).toEqual([carol, bob, alice]);
    });

    it('breaks equal keys (including the rest) by name, whatever dir says', async () => {
      const tied = await byRank({ ids: [carol, bob], keys: [1, 1], restKey: 2 });
      expect(tied.rows.map((r) => r.id)).toEqual([bob, carol, alice]);

      const withRest = await byRank({ ids: [carol], keys: [2], restKey: 2 });
      expect(withRest.rows.map((r) => r.id)).toEqual([alice, bob, carol]);
    });

    it('refuses a rank whose keys do not match its ids', async () => {
      await expect(byRank({ ids: [bob, alice], keys: [1], restKey: 2 })).rejects.toBeInstanceOf(
        RangeError,
      );
      await expect(byRank({ ids: [bob], keys: [1.5], restKey: 2 })).rejects.toBeInstanceOf(
        RangeError,
      );
    });

    it('returns total alongside a page', async () => {
      const { total, rows } = await inTenant(tenant, () =>
        repo.search({ view: 'active' }, { page: 1, size: 2, sort: 'name', dir: 'asc' }),
      );
      expect(total).toBe(3);
      expect(rows).toHaveLength(2);
    });

    it('returns the true total (not 0) for a page past the last row', async () => {
      const { total, rows } = await inTenant(tenant, () =>
        repo.search({ view: 'active' }, { page: 5, size: 2, sort: 'name', dir: 'asc' }),
      );
      expect(rows).toEqual([]);
      expect(total).toBe(3);
    });

    it('returns no rows when idsIn is empty', async () => {
      const { rows, total } = await inTenant(tenant, () =>
        repo.search({ view: 'active' }, { page: 1, size: 50, sort: 'name', dir: 'asc', idsIn: [] }),
      );
      expect(rows).toEqual([]);
      expect(total).toBe(0);
    });

    it('finds nothing by id for another tenant (RLS)', async () => {
      const other = newId();
      const { rows } = await inTenant(other, () =>
        repo.search({ view: 'active' }, { page: 1, size: 50, sort: 'name', dir: 'asc' }),
      );
      expect(rows).toEqual([]);
    });
  });

  describe('search: rank by dentist', () => {
    it('ranks by primaryDentistId (profile ids), with a NULL dentist landing at restKey', async () => {
      const tenant = newId();
      const dentistX = newId();
      const dentistY = newId();
      const withX = (await create(tenant, { primaryDentistId: dentistX })).id;
      const withY = (await create(tenant, { primaryDentistId: dentistY })).id;
      const withNone = (await create(tenant, { primaryDentistId: null })).id;

      const { rows } = await inTenant(tenant, () =>
        repo.search(
          { view: 'active' },
          {
            page: 1,
            size: 50,
            sort: 'dentist',
            dir: 'asc',
            rank: {
              column: 'primaryDentistId',
              ids: [dentistX, dentistY],
              keys: [1, 2],
              restKey: 3,
            },
          },
        ),
      );
      const ids = rows.map((r) => r.id);
      expect(ids.indexOf(withX)).toBeLessThan(ids.indexOf(withY));
      expect(ids.indexOf(withY)).toBeLessThan(ids.indexOf(withNone));
    });
  });

  describe('findByIds', () => {
    it('returns exactly the requested ids, and none for an empty list', async () => {
      const tenant = newId();
      const a = await create(tenant);
      const b = await create(tenant);
      await create(tenant); // a third, unrelated patient — must not come back

      const found = await inTenant(tenant, () => repo.findByIds([a.id, b.id]));
      expect(found.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());

      expect(await inTenant(tenant, () => repo.findByIds([]))).toEqual([]);
    });
  });

  describe('counts, duplicateRows, findTwins', () => {
    it('counts active and archived exactly', async () => {
      const tenant = newId();
      const active = await create(tenant);
      const toArchive = await create(tenant);
      await inTenant(tenant, () => repo.setArchived([toArchive.id], new Date()));

      const counts = await inTenant(tenant, () => repo.counts());
      expect(counts).toEqual({ active: 1, archived: 1 });
      expect(await inTenant(tenant, () => repo.findById(active.id))).toBeDefined();
    });

    it('groups duplicates by name key and date of birth, ≥ 2 rows only', async () => {
      const dupTenant = newId();
      const twinA = await create(dupTenant, {
        fullName: 'Twin Person',
        dateOfBirth: '1990-06-15',
      });
      const twinB = await create(dupTenant, {
        fullName: 'TWIN PERSON',
        dateOfBirth: '1990-06-15',
      });
      await create(dupTenant, { fullName: 'Lonely Person', dateOfBirth: '1990-06-15' });
      await create(dupTenant, { fullName: 'Twin Person', dateOfBirth: null });

      const rows = await inTenant(dupTenant, () => repo.duplicateRows());
      const ids = rows.map((r) => r.id);
      expect(ids.sort()).toEqual([twinA.id, twinB.id].sort());
    });

    it('finds twins by full name (case-insensitively) and date of birth, excluding a given id', async () => {
      const twinTenant = newId();
      const a = await create(twinTenant, { fullName: 'Same Name', dateOfBirth: '1985-03-03' });
      const b = await create(twinTenant, { fullName: 'same name', dateOfBirth: '1985-03-03' });

      const twins = await inTenant(twinTenant, () => repo.findTwins('Same Name', '1985-03-03'));
      expect(twins.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());

      // Case-insensitive: a differently-cased full name still finds the same twins.
      const twinsOtherCase = await inTenant(twinTenant, () =>
        repo.findTwins('SAME NAME', '1985-03-03'),
      );
      expect(twinsOtherCase.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());

      const excluding = await inTenant(twinTenant, () =>
        repo.findTwins('Same Name', '1985-03-03', a.id),
      );
      expect(excluding.map((t) => t.id)).toEqual([b.id]);
    });
  });

  describe('lockPair, setArchived, markMerged', () => {
    const tenant = newId();

    it('throws when called outside a transaction', async () => {
      const a = await create(tenant);
      const b = await create(tenant);
      await expect(inTenant(tenant, () => repo.lockPair(a.id, b.id))).rejects.toThrow(
        'lockPair must run inside a transaction',
      );
    });

    it('locks both rows regardless of argument order', async () => {
      const a = await create(tenant, { fullName: 'Lock A' });
      const b = await create(tenant, { fullName: 'Lock B' });
      const { a: lockedA, b: lockedB } = await inTenantTx(tenant, () => repo.lockPair(a.id, b.id));
      expect(lockedA.id).toBe(a.id);
      expect(lockedB.id).toBe(b.id);

      const reversed = await inTenantTx(tenant, () => repo.lockPair(b.id, a.id));
      expect(reversed.a.id).toBe(b.id);
      expect(reversed.b.id).toBe(a.id);
    });

    it('throws PatientNotFoundError when one id is missing', async () => {
      const a = await create(tenant);
      await expect(inTenantTx(tenant, () => repo.lockPair(a.id, newId()))).rejects.toBeInstanceOf(
        PatientNotFoundError,
      );
    });

    it('archives an active id and returns it as affected; leaves an already-archived id untouched', async () => {
      const active = await create(tenant);
      const alreadyArchived = await create(tenant);
      const at = new Date();
      await inTenant(tenant, () => repo.setArchived([alreadyArchived.id], at));

      const affected = await inTenant(tenant, () =>
        repo.setArchived([active.id, alreadyArchived.id], at),
      );
      expect(affected.map((row) => row.id)).toEqual([active.id]);
      expect(affected[0]?.deletedAt).toBeInstanceOf(Date);
    });

    it('restores an archived id and returns it as affected', async () => {
      const patient = await create(tenant);
      const at = new Date();
      await inTenant(tenant, () => repo.setArchived([patient.id], at));

      const restored = await inTenant(tenant, () => repo.setArchived([patient.id], null));
      expect(restored.map((row) => row.id)).toEqual([patient.id]);
      expect(restored[0]?.deletedAt).toBeNull();
      expect((await inTenant(tenant, () => repo.findById(patient.id)))?.deletedAt).toBeNull();
    });

    it('refuses to restore a merged-away record: not returned as affected, stays archived', async () => {
      const kept = await create(tenant);
      const dropped = await create(tenant);
      await inTenantTx(tenant, () => repo.lockPair(kept.id, dropped.id));
      await inTenant(tenant, () => repo.markMerged(dropped.id, kept.id, new Date()));

      const restored = await inTenant(tenant, () => repo.setArchived([dropped.id], null));
      expect(restored).toEqual([]);
      const stillMerged = await inTenant(tenant, () => repo.findById(dropped.id));
      expect(stillMerged?.deletedAt).toBeInstanceOf(Date);
      expect(stillMerged?.mergedIntoId).toBe(kept.id);
    });

    it('marks the dropped record merged into the kept one', async () => {
      const kept = await create(tenant);
      const dropped = await create(tenant);
      const at = new Date();
      const merged = await inTenant(tenant, () => repo.markMerged(dropped.id, kept.id, at));
      expect(merged?.mergedIntoId).toBe(kept.id);
      expect(merged?.deletedAt).toBeInstanceOf(Date);
    });

    it('refuses to merge a record into itself (check constraint)', async () => {
      const patient = await create(tenant);
      await expect(
        inTenant(tenant, () => repo.markMerged(patient.id, patient.id, new Date())),
      ).rejects.toMatchObject({ cause: { constraint: 'patients_not_merged_into_self' } });
      const unchanged = await inTenant(tenant, () => repo.findById(patient.id));
      expect(unchanged).toMatchObject({ mergedIntoId: null, deletedAt: null });
    });

    it('findForUpdate needs a transaction and reads the row inside one', async () => {
      const patient = await create(tenant);
      await expect(inTenant(tenant, () => repo.findForUpdate(patient.id))).rejects.toThrow(
        'findForUpdate must run inside a transaction',
      );
      expect((await inTenantTx(tenant, () => repo.findForUpdate(patient.id)))?.id).toBe(patient.id);
      expect(await inTenantTx(tenant, () => repo.findForUpdate(newId()))).toBeUndefined();
    });

    it('findByIdsForUpdate needs a transaction and returns the visible rows among the ids', async () => {
      const a = await create(tenant);
      const b = await create(tenant);
      await expect(inTenant(tenant, () => repo.findByIdsForUpdate([a.id]))).rejects.toThrow(
        'findByIdsForUpdate must run inside a transaction',
      );
      const locked = await inTenantTx(tenant, () => repo.findByIdsForUpdate([b.id, newId(), a.id]));
      expect(locked.map((row) => row.id).sort()).toEqual([a.id, b.id].sort());
      expect(await inTenantTx(newId(), () => repo.findByIdsForUpdate([a.id]))).toEqual([]);
    });
  });

  describe('search: contacts (addendum C7)', () => {
    const tenant = newId();
    let child: string;
    let mother: string;
    let father: string;
    let motherPatient: string;
    let sibling: string;
    let adult: string;

    type Roles = Partial<Record<'isGuardian' | 'isBillingContact' | 'isEmergencyContact', boolean>>;
    /** Links through the domain plan, as the service will (first holder becomes primary). */
    const linkIn = (
      tenantId: string,
      patientId: string,
      contactId: string,
      roles: Roles,
      relationship: 'parent' | 'sibling' | 'other' = 'parent',
    ) =>
      inTenantTx(tenantId, async () => {
        const plan = planLinkChange(patientId, await links.linksOf(patientId), {
          kind: 'link',
          contactId,
          relationship,
          roles: {
            isGuardian: false,
            isBillingContact: false,
            isEmergencyContact: false,
            ...roles,
          },
        });
        await links.applyLinkPlan(plan);
      });
    const contactIn = (tenantId: string, fullName: string, phone: NormalizedPhoneInput | null) =>
      inTenant(tenantId, () => contactsRepo.insert({ fullName, phone, email: null }));
    const q = (query: string) =>
      inTenant(tenant, () =>
        repo.search({ view: 'active', q: query }, { page: 1, size: 50, sort: 'name', dir: 'asc' }),
      );
    const byId = async (query: string) =>
      new Map((await q(query)).rows.map((row) => [row.id, row]));

    beforeAll(async () => {
      // A phoneless child whose mother and father (contacts) have phones sharing digits.
      child = (
        await create(tenant, { fullName: 'Sami Haddad', phone: null, dateOfBirth: '2019-05-01' })
      ).id;
      mother = (await contactIn(tenant, 'Mona Haddad', PHONE('+9613456781', '03456781'))).id;
      father = (await contactIn(tenant, 'Karim Haddad', PHONE('+9613456782', '03456782'))).id;
      await linkIn(tenant, child, mother, { isGuardian: true, isBillingContact: true });
      await linkIn(tenant, child, father, { isGuardian: true, isEmergencyContact: true });
      // A second child whose guardian is a patient herself: her phone lives on her record.
      motherPatient = (
        await create(tenant, { fullName: 'Rania Saleh', phone: PHONE('+9617111222', '07111222') })
      ).id;
      const linkedMother = await inTenant(tenant, () => contactsRepo.insertLinked(motherPatient));
      sibling = (
        await create(tenant, { fullName: 'Lina Saleh', phone: null, dateOfBirth: '2020-01-01' })
      ).id;
      await linkIn(tenant, sibling, linkedMother.id, { isGuardian: true });
      // An adult matching the same digits by their own phone and through a contact.
      adult = (
        await create(tenant, {
          fullName: 'Adult Own Phone',
          phone: PHONE('+9613456789', '03456789'),
        })
      ).id;
      await linkIn(tenant, adult, father, { isEmergencyContact: true }, 'other');
    });

    it('matches a child by the guardian phone digits, with matchedContact set', async () => {
      const rows = await byId('03 456 781');
      expect([...rows.keys()]).toEqual([child]);
      expect(rows.get(child)?.matchedContact).toEqual({
        fullName: 'Mona Haddad',
        relationship: 'parent',
      });
    });

    it('returns one row per patient, and a true total, when several contacts match', async () => {
      const { rows, total } = await q('0345678');
      const ids = rows.map((row) => row.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(total).toBe(ids.length);
      expect([...ids].sort()).toEqual([adult, child].sort());
      // Mother and father both match: the primary guardian is the "via" contact.
      expect(rows.find((row) => row.id === child)?.matchedContact).toEqual({
        fullName: 'Mona Haddad',
        relationship: 'parent',
      });
    });

    it('leaves matchedContact null when the patient matched on its own fields', async () => {
      expect((await byId('0345678')).get(adult)?.matchedContact).toBeNull();
      expect((await byId('Sami')).get(child)?.matchedContact).toBeNull();
    });

    it('matches through a linked patient phone (resolved); the mother matches on her own', async () => {
      const rows = await byId('07111');
      expect([...rows.keys()].sort()).toEqual([motherPatient, sibling].sort());
      expect(rows.get(sibling)?.matchedContact).toEqual({
        fullName: 'Rania Saleh',
        relationship: 'parent',
      });
      expect(rows.get(motherPatient)?.matchedContact).toBeNull();
    });

    it('never matches contact phones for a patient-number query or a single digit', async () => {
      expect((await q('3')).rows.map((row) => row.id)).not.toContain(child);
      expect((await q('P-0345678')).rows).toEqual([]);
    });

    it('carries the resolved primary guardian on every row, searched or not', async () => {
      const all = await inTenant(tenant, () =>
        repo.search({ view: 'active' }, { page: 1, size: 50, sort: 'name', dir: 'asc' }),
      );
      const rows = new Map(all.rows.map((row) => [row.id, row]));
      expect(rows.get(child)?.primaryGuardian).toEqual({
        contactId: mother,
        fullName: 'Mona Haddad',
        phone: '+9613456781',
        relationship: 'parent',
      });
      expect(rows.get(sibling)?.primaryGuardian).toMatchObject({
        fullName: 'Rania Saleh',
        phone: '+9617111222',
      });
      // An emergency contact is no guardian.
      expect(rows.get(adult)?.primaryGuardian).toBeNull();
      expect(rows.get(child)?.matchedContact).toBeNull();
      expect(all.total).toBe(all.rows.length);
    });

    it('ignores soft-deleted contacts, for the match and the primary guardian', async () => {
      const ghostTenant = newId();
      const kid = (await create(ghostTenant, { fullName: 'Ghost Kid', phone: null })).id;
      const ghost = await contactIn(ghostTenant, 'Ghost', PHONE('+9613909090', '03909090'));
      await linkIn(ghostTenant, kid, ghost.id, { isGuardian: true });
      await inTenant(ghostTenant, () => contactsRepo.softDelete([ghost.id], new Date()));
      const search = (query?: string) =>
        inTenant(ghostTenant, () =>
          repo.search(
            { view: 'active', ...(query === undefined ? {} : { q: query }) },
            { page: 1, size: 10, sort: 'name', dir: 'asc' },
          ),
        );
      expect((await search('0390909')).rows).toEqual([]);
      expect((await search()).rows.map((row) => row.primaryGuardian)).toEqual([null]);
    });

    it('carries the primary guardian on duplicate rows and twins too', async () => {
      const twinTenant = newId();
      const first = await create(twinTenant, {
        fullName: 'Twin Kid',
        dateOfBirth: '2018-01-01',
        phone: null,
      });
      await create(twinTenant, { fullName: 'Twin Kid', dateOfBirth: '2018-01-01', phone: null });
      const guardian = await contactIn(twinTenant, 'Twin Parent', null);
      await linkIn(twinTenant, first.id, guardian.id, { isGuardian: true });
      const duplicates = await inTenant(twinTenant, () => repo.duplicateRows());
      expect(duplicates.find((row) => row.id === first.id)?.primaryGuardian?.fullName).toBe(
        'Twin Parent',
      );
      const twins = await inTenant(twinTenant, () => repo.findTwins('twin kid', '2018-01-01'));
      expect(twins.map((row) => row.primaryGuardian?.contactId ?? 'none').sort()).toEqual(
        [guardian.id, 'none'].sort(),
      );
      expect(twins.every((row) => row.matchedContact === null)).toBe(true);
    });
  });

  describe('tenant isolation (RLS)', () => {
    it('tenant B cannot read, search or count tenant A patients', async () => {
      const tenantA = newId();
      const tenantB = newId();

      const a = await create(tenantA, { fullName: 'A Only' });

      expect(await inTenant(tenantB, () => repo.findById(a.id))).toBeUndefined();
      const { rows } = await inTenant(tenantB, () =>
        repo.search({ view: 'active' }, { page: 1, size: 50, sort: 'name', dir: 'asc' }),
      );
      expect(rows.map((r) => r.id)).not.toContain(a.id);

      const countsA = await inTenant(tenantA, () => repo.counts());
      expect(countsA.active).toBe(1);
      const countsB = await inTenant(tenantB, () => repo.counts());
      expect(countsB.active).toBe(0);
    });

    it("A's counter increments never advance B's, and B starts fresh at 1", async () => {
      const tenantA = newId();
      const tenantB = newId();

      expect(await inTenant(tenantA, () => counters.nextValue())).toBe(1);
      expect(await inTenant(tenantA, () => counters.nextValue())).toBe(2);

      expect(await inTenant(tenantB, () => counters.nextValue())).toBe(1);
      expect(await inTenant(tenantA, () => counters.nextValue())).toBe(3);
    });

    it('writes from tenant B never affect a patient that belongs to tenant A', async () => {
      const tenantA = newId();
      const tenantB = newId();
      const a = await create(tenantA, { fullName: 'A Only' });
      const bOwn = await create(tenantB, { fullName: 'B Own' });

      expect(
        await inTenant(tenantB, () => repo.update(a.id, { fullName: 'Hijacked' })),
      ).toBeUndefined();
      expect((await inTenant(tenantA, () => repo.findById(a.id)))?.fullName).toBe('A Only');

      expect(await inTenant(tenantB, () => repo.setArchived([a.id], new Date()))).toEqual([]);
      expect((await inTenant(tenantA, () => repo.findById(a.id)))?.deletedAt).toBeNull();

      expect(
        await inTenant(tenantB, () => repo.markMerged(a.id, bOwn.id, new Date())),
      ).toBeUndefined();
      expect((await inTenant(tenantA, () => repo.findById(a.id)))?.mergedIntoId).toBeNull();

      await expect(inTenantTx(tenantB, () => repo.lockPair(a.id, bOwn.id))).rejects.toBeInstanceOf(
        PatientNotFoundError,
      );
    });
  });
});
