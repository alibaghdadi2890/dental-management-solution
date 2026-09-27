import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PatientNotFoundError } from '../../src/modules/patients/domain/patient-errors';
import { PatientCountersRepository } from '../../src/modules/patients/persistence/patient-counters.repository';
import {
  type NewPatient,
  type NormalizedPhoneInput,
  PatientsRepository,
} from '../../src/modules/patients/persistence/patients.repository';
import { type ContextSeed, RequestContext } from '../../src/platform/cls/request-context';
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
    emergencyContact: null,
    notes: null,
    medicalAlerts: [],
    primaryDentistUserId: null,
    guardianName: null,
    guardianPhone: null,
    externalId: null,
    ...overrides,
  };
}

describe('patients: repositories', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let context: RequestContext;
  let repo: PatientsRepository;
  let counters: PatientCountersRepository;

  const seed = (tenantId: string, extra: Partial<ContextSeed> = {}): ContextSeed => ({
    requestId: `req-${newId()}`,
    actorKind: 'user',
    tenantId,
    userId: newId(),
    ...extra,
  });
  const inTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
    context.run(seed(tenantId), fn);
  const create = (tenantId: string, overrides: Partial<NewPatient> = {}) =>
    inTenant(tenantId, () => repo.insert(newPatient(overrides)));

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    context = testApp.app.get(RequestContext);
    repo = testApp.app.get(PatientsRepository);
    counters = testApp.app.get(PatientCountersRepository);
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

    it('does not match phone digits when the query is a single digit', async () => {
      const { rows } = await q('7');
      expect(rows.map((r) => r.id)).not.toContain(jose);
    });

    it('treats a literal "%" in the query as a literal character, not a wildcard', async () => {
      const { rows } = await q('a%b');
      expect(rows.map((r) => r.id)).toEqual([percent]);
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
      withDentistA = (await create(tenant, { primaryDentistUserId: dentistA })).id;
      await create(tenant, { primaryDentistUserId: dentistB });
      noDentist = (await create(tenant, { primaryDentistUserId: null })).id;
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
      // Touch all three via the application clock (`$onUpdate`) so their relative order never
      // depends on comparing against a bare `created_at`: that comes from Postgres' own clock
      // (`defaultNow()`), which can drift from the application clock (e.g. Docker Desktop on
      // Windows) enough to flip an otherwise-correct ordering.
      await inTenant(tenant, () => repo.update(carol, { notes: 'touched 1st' }));
      await inTenant(tenant, () => repo.update(bob, { notes: 'touched 2nd' }));
      await inTenant(tenant, () => repo.update(alice, { notes: 'touched 3rd, most recent' }));
      const { rows } = await inTenant(tenant, () =>
        repo.search({ view: 'active' }, { page: 1, size: 50, sort: 'recent', dir: 'asc' }),
      );
      expect(rows.map((r) => r.id)).toEqual([alice, bob, carol]);
    });

    it('orders by rank with unlisted rows at restAt', async () => {
      const { rows } = await inTenant(tenant, () =>
        repo.search(
          { view: 'active' },
          {
            page: 1,
            size: 50,
            sort: 'balance',
            dir: 'asc',
            rank: { column: 'id', ids: [bob, alice], restAt: 999 },
          },
        ),
      );
      const ids = rows.map((r) => r.id);
      expect(ids.indexOf(bob)).toBeLessThan(ids.indexOf(alice));
      expect(ids.indexOf(alice)).toBeLessThan(ids.indexOf(carol));
    });

    it('returns total alongside a page', async () => {
      const { total, rows } = await inTenant(tenant, () =>
        repo.search({ view: 'active' }, { page: 1, size: 2, sort: 'name', dir: 'asc' }),
      );
      expect(total).toBe(3);
      expect(rows).toHaveLength(2);
    });

    it('returns no rows when idsIn is empty', async () => {
      const { rows, total } = await inTenant(tenant, () =>
        repo.search({ view: 'active' }, { page: 1, size: 50, sort: 'name', dir: 'asc', idsIn: [] }),
      );
      expect(rows).toEqual([]);
      expect(total).toBe(0);
    });
  });

  describe('counts, duplicateRows, findTwins', () => {
    const tenant = newId();

    it('counts active and archived separately', async () => {
      const active = await create(tenant);
      const toArchive = await create(tenant);
      await inTenant(tenant, () => repo.setArchived([toArchive.id], new Date()));

      const counts = await inTenant(tenant, () => repo.counts());
      expect(counts.active).toBeGreaterThanOrEqual(1);
      expect(counts.archived).toBeGreaterThanOrEqual(1);
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

    it('finds twins by name key and date of birth, excluding a given id', async () => {
      const twinTenant = newId();
      const a = await create(twinTenant, { fullName: 'Same Name', dateOfBirth: '1985-03-03' });
      const b = await create(twinTenant, { fullName: 'same name', dateOfBirth: '1985-03-03' });

      const twins = await inTenant(twinTenant, () => repo.findTwins('same name', '1985-03-03'));
      expect(twins.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());

      const excluding = await inTenant(twinTenant, () =>
        repo.findTwins('same name', '1985-03-03', a.id),
      );
      expect(excluding.map((t) => t.id)).toEqual([b.id]);
    });
  });

  describe('lockPair, setArchived, markMerged', () => {
    const tenant = newId();

    it('locks both rows regardless of argument order', async () => {
      const a = await create(tenant, { fullName: 'Lock A' });
      const b = await create(tenant, { fullName: 'Lock B' });
      const { a: lockedA, b: lockedB } = await inTenant(tenant, () => repo.lockPair(a.id, b.id));
      expect(lockedA.id).toBe(a.id);
      expect(lockedB.id).toBe(b.id);

      const reversed = await inTenant(tenant, () => repo.lockPair(b.id, a.id));
      expect(reversed.a.id).toBe(b.id);
      expect(reversed.b.id).toBe(a.id);
    });

    it('throws PatientNotFoundError when one id is missing', async () => {
      const a = await create(tenant);
      await expect(inTenant(tenant, () => repo.lockPair(a.id, newId()))).rejects.toBeInstanceOf(
        PatientNotFoundError,
      );
    });

    it('archives and restores by id, returning the affected ids', async () => {
      const a = await create(tenant);
      const b = await create(tenant);
      const at = new Date();
      const archived = await inTenant(tenant, () => repo.setArchived([a.id, b.id], at));
      expect(archived.sort()).toEqual([a.id, b.id].sort());
      expect((await inTenant(tenant, () => repo.findById(a.id)))?.deletedAt).toBeInstanceOf(Date);

      const restored = await inTenant(tenant, () => repo.setArchived([a.id, b.id], null));
      expect(restored.sort()).toEqual([a.id, b.id].sort());
      expect((await inTenant(tenant, () => repo.findById(a.id)))?.deletedAt).toBeNull();
    });

    it('marks the dropped record merged into the kept one', async () => {
      const kept = await create(tenant);
      const dropped = await create(tenant);
      const at = new Date();
      const merged = await inTenant(tenant, () => repo.markMerged(dropped.id, kept.id, at));
      expect(merged?.mergedIntoId).toBe(kept.id);
      expect(merged?.deletedAt).toBeInstanceOf(Date);
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
  });
});
