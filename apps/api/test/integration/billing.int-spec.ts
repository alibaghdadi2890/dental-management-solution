import type {
  AuditEntry,
  AuditPage,
  Branch,
  OpeningBalanceResult,
  Patient,
  PatientBalance,
  PatientContact,
  ProblemDetails,
  Session,
  Tenant,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing';
import { LedgerEntriesRepository } from '../../src/modules/billing/persistence/ledger-entries.repository';
import { PatientNotFoundError, PatientsService } from '../../src/modules/patients';
import { PermissionDeniedError } from '../../src/platform/cls/permission-denied.error';
import { RequestContext } from '../../src/platform/cls/request-context';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn, signInAndSetPassword, uniqueEmail } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';
import { asPlatformAdminIn } from '../support/tenants';

const TEMPORARY = 'temporary-pw-1';

/** Beirut is UTC+3 in June: the tenant's today is 2026-06-10 all day at this instant. */
const NOON = '2026-06-10T09:00:00Z';
const TODAY = '2026-06-10';

/** A minor on any date this suite runs (the phone rule lets them go without a phone). */
const CHILD_DOB = '2018-05-01';

interface Clinic {
  tenant: Tenant;
  owner: TestAgent;
  branch: Branch;
}

const firstPath = (body: unknown) => (body as ProblemDetails).errors?.[0]?.path;

const problem = (body: unknown) => body as ProblemDetails;

type Roles = Partial<Record<'isGuardian' | 'isBillingContact' | 'isEmergencyContact', boolean>>;

const newContact = (fullName: string, phone: string) => ({ newContact: { fullName, phone } });

const linkInput = (target: object, relationship: string, roles: Roles = { isGuardian: true }) => ({
  target,
  relationship,
  ...roles,
});

describe('billing: ledger, opening balances and balances', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;
  let main: Clinic;

  const provision = async (name: string): Promise<Clinic> => {
    const ownerEmail = uniqueEmail('owner');
    const response = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name, slug: `bil-${newId().slice(-12)}` },
      firstBranch: { name: `${name} Main` },
      owner: { displayName: `${name} Owner`, email: ownerEmail, temporaryPassword: TEMPORARY },
    });
    expect(response.status).toBe(201);
    const owner = await signInAndSetPassword(testApp.app, ownerEmail, TEMPORARY);
    const [branch] = (await owner.get('/api/v1/branches')).body as Branch[];
    if (!branch) throw new Error('provisioning created no branch');
    return { tenant: response.body as Tenant, owner, branch };
  };

  const staffAgent = async (clinic: Clinic, role: 'assistant' | 'frontdesk') => {
    const email = uniqueEmail(role);
    const response = await clinic.owner.post('/api/v1/users').send({
      displayName: `The ${role}`,
      email,
      practitionerType: role,
      roleKeys: [role],
      branchIds: [clinic.branch.id],
      temporaryPassword: TEMPORARY,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return signInAndSetPassword(testApp.app, email, TEMPORARY);
  };

  const openWithBalance = async (
    agent: TestAgent,
    fullName: string,
    amount: string,
    asOf = TODAY,
  ): Promise<OpeningBalanceResult> => {
    const response = await agent
      .post('/api/v1/billing/opening-balances')
      .send({ patient: { fullName, phone: '71 000 000' }, openingBalance: { amount, asOf } });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as OpeningBalanceResult;
  };

  const createPatient = async (agent: TestAgent, fullName: string): Promise<Patient> => {
    const response = await agent.post('/api/v1/patients').send({ fullName, phone: '71 000 000' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Patient;
  };

  const createPatientWith = async (agent: TestAgent, body: Record<string, unknown>) => {
    const response = await agent.post('/api/v1/patients').send(body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Patient;
  };

  const contactsOf = async (agent: TestAgent, patientId: string) => {
    const response = await agent.get(`/api/v1/patients/${patientId}/contacts`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as PatientContact[];
  };

  const counterOf = async (tenantId: string) =>
    (
      await database.ownerPool.query<{ last_value: number }>(
        'select last_value::int from patient_counters where tenant_id = $1',
        [tenantId],
      )
    ).rows[0]?.last_value ?? 0;

  /** Counts of new rows a rolled-back opening balance with contacts must leave at zero. */
  const contactsLeftovers = async (tenantId: string) =>
    (
      await database.ownerPool.query<{
        patients: number;
        contacts: number;
        links: number;
        entries: number;
      }>(
        `select (select count(*) from patients where tenant_id = $1)::int as patients,
                (select count(*) from contacts where tenant_id = $1)::int as contacts,
                (select count(*) from patient_contacts where tenant_id = $1)::int as links,
                (select count(*) from ledger_entries where tenant_id = $1)::int as entries`,
        [tenantId],
      )
    ).rows[0];

  const adjust = (agent: TestAgent, patientId: string, body: Record<string, unknown>) =>
    agent.post(`/api/v1/billing/patients/${patientId}/adjustments`).send(body);

  const balanceOf = async (agent: TestAgent, patientId: string) => {
    const response = await agent.get(`/api/v1/billing/patients/${patientId}/balance`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as PatientBalance;
  };

  const auditOf = async (agent: TestAgent, query: string): Promise<AuditEntry[]> =>
    ((await agent.get(`/api/v1/audit?${query}&limit=100`)).body as AuditPage).items;

  const events = async (agent: TestAgent, name: string) =>
    (await auditOf(agent, 'resourceType=event')).filter((entry) => entry.action === name);

  const ledgerRows = async (tenantId: string) =>
    (
      await database.ownerPool.query<{
        patient_id: string;
        kind: string;
        amount: string;
        currency: string;
        effective_date: string;
        reason: string | null;
        created_by: string;
      }>(
        `select patient_id, kind, amount::text, currency, effective_date::text, reason, created_by
         from ledger_entries where tenant_id = $1 order by created_at, id`,
        [tenantId],
      )
    ).rows;

  const patientNames = async (tenantId: string) =>
    (
      await database.ownerPool.query<{ full_name: string }>(
        'select full_name from patients where tenant_id = $1 order by display_number',
        [tenantId],
      )
    ).rows.map((row) => row.full_name);

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(new Date(NOON));
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    main = await provision('Billing Clinic');
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('create with an opening balance', () => {
    it('creates the patient and an audited opening_balance entry in the tenant currency', async () => {
      const clinic = await provision('Opening Clinic');
      const { patient, balance } = await openWithBalance(clinic.owner, 'Lina Aoun', '250');
      expect(patient).toMatchObject({ displayNumber: 'P-000001', fullName: 'Lina Aoun' });
      expect(balance).toEqual({
        patientId: patient.id,
        balances: [{ amount: '250.00', currency: 'USD' }],
      });

      const session = (await clinic.owner.get('/api/v1/session')).body as Session;
      expect(await ledgerRows(clinic.tenant.id)).toEqual([
        {
          patient_id: patient.id,
          kind: 'opening_balance',
          amount: '250.00',
          currency: 'USD',
          effective_date: TODAY,
          reason: null,
          created_by: session.user.id,
        },
      ]);

      const [entry] = await auditOf(clinic.owner, 'resourceType=ledger_entry');
      expect(entry).toMatchObject({
        action: 'ledger_entry.create',
        actorUserId: session.user.id,
        after: {
          patientId: patient.id,
          kind: 'opening_balance',
          amount: '250.00',
          currency: 'USD',
          effectiveDate: TODAY,
        },
      });
      const [created] = await events(clinic.owner, 'PatientCreated');
      expect(created?.after).toEqual({ patientId: patient.id });
      const [recorded] = await events(clinic.owner, 'LedgerEntryRecorded');
      expect(recorded?.after).toEqual({
        entryId: entry?.resourceId,
        patientId: patient.id,
        kind: 'opening_balance',
      });
    });

    it('is all-or-nothing: a refused patient or a failed entry leaves nothing behind', async () => {
      const clinic = await provision('Atomic Clinic');
      await openWithBalance(clinic.owner, 'First', '10.00');

      const badPhone = await clinic.owner.post('/api/v1/billing/opening-balances').send({
        patient: { fullName: 'Bad Phone', phone: '12' },
        openingBalance: { amount: '10.00', asOf: TODAY },
      });
      expect(badPhone.status).toBe(422);
      expect(badPhone.body).toMatchObject({ code: 'validation_failed' });
      expect(firstPath(badPhone.body)).toBe('patient.phone');

      const insert = vi
        .spyOn(testApp.app.get(LedgerEntriesRepository), 'insert')
        .mockRejectedValueOnce(new Error('ledger unavailable'));
      try {
        const failed = await clinic.owner.post('/api/v1/billing/opening-balances').send({
          patient: { fullName: 'Lost Patient', phone: '71 000 001' },
          openingBalance: { amount: '10.00', asOf: TODAY },
        });
        expect(failed.status).toBe(500);
        expect(insert).toHaveBeenCalledOnce();
      } finally {
        insert.mockRestore();
      }

      const next = await openWithBalance(clinic.owner, 'Second', '20.00');
      expect(next.patient.displayNumber).toBe('P-000002');
      expect(await patientNames(clinic.tenant.id)).toEqual(['First', 'Second']);
      expect((await ledgerRows(clinic.tenant.id)).map((row) => row.amount)).toEqual([
        '10.00',
        '20.00',
      ]);
      const creates = await auditOf(clinic.owner, 'resourceType=patient');
      expect(creates.map((entry) => (entry.after as Patient).fullName).sort()).toEqual([
        'First',
        'Second',
      ]);
    });

    it("refuses an asOf after the tenant's today before creating anything", async () => {
      const clinic = await provision('Future Clinic');
      const original = testApp.clock.now();
      // 22:30 UTC on 1 March is already 2 March in Beirut (UTC+2 in winter).
      testApp.clock.set(new Date('2026-03-01T22:30:00Z'));
      try {
        const tomorrow = await clinic.owner.post('/api/v1/billing/opening-balances').send({
          patient: { fullName: 'Too Early', phone: '71 000 000' },
          openingBalance: { amount: '10.00', asOf: '2026-03-03' },
        });
        expect(tomorrow.status).toBe(422);
        expect(tomorrow.body).toMatchObject({ code: 'validation_failed' });
        expect(firstPath(tomorrow.body)).toBe('openingBalance.asOf');
        expect(await patientNames(clinic.tenant.id)).toEqual([]);
        expect(await ledgerRows(clinic.tenant.id)).toEqual([]);

        // The tenant's today is fine even though UTC is still on the day before.
        const today = await openWithBalance(clinic.owner, 'On Time', '10.00', '2026-03-02');
        expect(today.patient.displayNumber).toBe('P-000001');
      } finally {
        testApp.clock.set(original);
      }
    });

    it('validates the body: a positive amount and both parts are required', async () => {
      for (const body of [
        {
          patient: { fullName: 'Zero', phone: '71000000' },
          openingBalance: { amount: '0', asOf: TODAY },
        },
        {
          patient: { fullName: 'Credit', phone: '71000000' },
          openingBalance: { amount: '-5.00', asOf: TODAY },
        },
        {
          patient: { fullName: 'Cents', phone: '71000000' },
          openingBalance: { amount: '1.234', asOf: TODAY },
        },
        { patient: { fullName: 'No Balance', phone: '71000000' } },
      ]) {
        const response = await main.owner.post('/api/v1/billing/opening-balances').send(body);
        expect(response.status, JSON.stringify(body)).toBe(400);
      }
    });
  });

  describe('create with an opening balance and contacts (design addendum C4, I1)', () => {
    it('creates the patient, a new guardian and the opening entry in one transaction', async () => {
      const clinic = await provision('Opening Contacts Clinic');
      const response = await clinic.owner.post('/api/v1/billing/opening-balances').send({
        patient: {
          fullName: 'Karim Haddad',
          dateOfBirth: CHILD_DOB,
          contacts: [
            linkInput(newContact('Rania Haddad', '71 600 001'), 'parent', {
              isGuardian: true,
              isBillingContact: true,
            }),
          ],
        },
        openingBalance: { amount: '75.00', asOf: TODAY },
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const { patient, balance } = response.body as OpeningBalanceResult;
      expect(patient).toMatchObject({ fullName: 'Karim Haddad', phone: null });
      expect(balance.balances).toEqual([{ amount: '75.00', currency: 'USD' }]);

      const [guardian] = await contactsOf(clinic.owner, patient.id);
      expect(guardian).toMatchObject({
        contact: { fullName: 'Rania Haddad', phone: '+96171600001' },
        relationship: 'parent',
        isGuardian: true,
        isBillingContact: true,
        isPrimaryGuardian: true,
        isPrimaryBilling: true,
      });

      const patientEntries = await auditOf(
        clinic.owner,
        `resourceType=patient&resourceId=${patient.id}`,
      );
      expect(patientEntries.map((entry) => entry.action).sort()).toEqual([
        'contact.link',
        'patient.create',
      ]);
      const [ledgerAudit] = await auditOf(clinic.owner, 'resourceType=ledger_entry');
      expect(ledgerAudit).toMatchObject({
        action: 'ledger_entry.create',
        after: { patientId: patient.id, kind: 'opening_balance' },
      });
      const [linked] = await events(clinic.owner, 'ContactLinked');
      expect(linked?.after).toEqual({ patientId: patient.id, contactId: guardian?.contact.id });
    });

    it('makes an existing unlinked contact the new patient via patient.linkContactId', async () => {
      const clinic = await provision('LinkContactId Clinic');
      const child = await createPatientWith(clinic.owner, {
        fullName: 'Zein Fares',
        dateOfBirth: CHILD_DOB,
        contacts: [linkInput(newContact('Huda Fares', '71 700 001'), 'parent')],
      });
      const [before] = await contactsOf(clinic.owner, child.id);
      const contactId = before?.contact.id;
      if (!contactId) throw new Error('no guardian');

      const response = await clinic.owner.post('/api/v1/billing/opening-balances').send({
        patient: { fullName: 'Huda Fares', phone: '71 700 002', linkContactId: contactId },
        openingBalance: { amount: '15.00', asOf: TODAY },
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const { patient } = response.body as OpeningBalanceResult;
      expect(patient.fullName).toBe('Huda Fares');

      const [after] = await contactsOf(clinic.owner, child.id);
      expect(after?.contact.linkedPatient?.id).toBe(patient.id);
    });

    it('reports an unknown linkContactId under patient.linkContactId and creates nothing', async () => {
      const clinic = await provision('LinkContactId Rollback Clinic');
      const before = await counterOf(clinic.tenant.id);

      const response = await clinic.owner.post('/api/v1/billing/opening-balances').send({
        patient: { fullName: 'Ghost Link', phone: '71 700 003', linkContactId: newId() },
        openingBalance: { amount: '10.00', asOf: TODAY },
      });
      expect(response.status).toBe(422);
      expect(problem(response.body)).toMatchObject({
        code: 'validation_failed',
        errors: [{ path: 'patient.linkContactId', code: 'not_found' }],
      });

      expect(await contactsLeftovers(clinic.tenant.id)).toEqual({
        patients: 0,
        contacts: 0,
        links: 0,
        entries: 0,
      });
      expect(await counterOf(clinic.tenant.id)).toBe(before);
    });

    it('reports an unknown contact target under patient.contacts and creates nothing', async () => {
      const clinic = await provision('Contacts Rollback Clinic');
      const before = await counterOf(clinic.tenant.id);

      const response = await clinic.owner.post('/api/v1/billing/opening-balances').send({
        patient: {
          fullName: 'Never Billed',
          dateOfBirth: CHILD_DOB,
          contacts: [linkInput({ contactId: newId() }, 'parent')],
        },
        openingBalance: { amount: '10.00', asOf: TODAY },
      });
      expect(response.status).toBe(422);
      expect(problem(response.body)).toMatchObject({
        code: 'validation_failed',
        errors: [{ path: 'patient.contacts.0.target.contactId', code: 'not_found' }],
      });

      expect(await contactsLeftovers(clinic.tenant.id)).toEqual({
        patients: 0,
        contacts: 0,
        links: 0,
        entries: 0,
      });
      expect(await counterOf(clinic.tenant.id)).toBe(before);
    });

    it('rolls the patient and its just-linked contact back when the ledger insert fails', async () => {
      const clinic = await provision('Contacts Ledger Rollback Clinic');
      const before = await counterOf(clinic.tenant.id);
      const insert = vi
        .spyOn(testApp.app.get(LedgerEntriesRepository), 'insert')
        .mockRejectedValueOnce(new Error('ledger unavailable'));
      try {
        const response = await clinic.owner.post('/api/v1/billing/opening-balances').send({
          patient: {
            fullName: 'Rolled Back Kid',
            dateOfBirth: CHILD_DOB,
            contacts: [linkInput(newContact('Rolled Guardian', '71 800 001'), 'parent')],
          },
          openingBalance: { amount: '10.00', asOf: TODAY },
        });
        expect(response.status).toBe(500);
        expect(insert).toHaveBeenCalledOnce();
      } finally {
        insert.mockRestore();
      }

      expect(await contactsLeftovers(clinic.tenant.id)).toEqual({
        patients: 0,
        contacts: 0,
        links: 0,
        entries: 0,
      });
      expect(await counterOf(clinic.tenant.id)).toBe(before);
    });
  });

  describe('recordOpeningBalance (service building block)', () => {
    it('refuses an unknown patient with patient.not_found', async () => {
      const service = testApp.app.get(BillingService);
      await expect(
        asPlatformAdminIn(testApp.app, main.tenant.id, () =>
          service.recordOpeningBalance(newId(), { amount: '5.00', asOf: TODAY, note: null }),
        ),
      ).rejects.toBeInstanceOf(PatientNotFoundError);
    });
  });

  describe('PatientsService.lockForDependentWrite', () => {
    it('refuses to run outside the caller transaction (the lock would be released at once)', async () => {
      const { patient } = await openWithBalance(main.owner, 'Lock Outside', '1.00');
      await expect(
        asPlatformAdminIn(testApp.app, main.tenant.id, () =>
          testApp.app.get(PatientsService).lockForDependentWrite(patient.id),
        ),
      ).rejects.toThrow(/inside a transaction/);
    });
  });

  describe('balances', () => {
    it('reads one patient: the sum, [] without entries, 404 for an unknown id', async () => {
      const { patient } = await openWithBalance(main.owner, 'Owes 250', '250.00');
      expect(await balanceOf(main.owner, patient.id)).toEqual({
        patientId: patient.id,
        balances: [{ amount: '250.00', currency: 'USD' }],
      });

      const plain = await createPatient(main.owner, 'No Entries');
      expect(await balanceOf(main.owner, plain.id)).toEqual({ patientId: plain.id, balances: [] });

      const unknown = await main.owner.get(`/api/v1/billing/patients/${newId()}/balance`);
      expect(unknown.status).toBe(404);
      expect(unknown.body).toMatchObject({ code: 'patient.not_found' });
      expect((await main.owner.get('/api/v1/billing/patients/abc/balance')).status).toBe(400);
    });

    it('reads many in input order, omitting unknown ids and de-duplicating', async () => {
      const { patient: owing } = await openWithBalance(main.owner, 'Many Owing', '12.50');
      const plain = await createPatient(main.owner, 'Many Plain');
      const response = await main.owner.get(
        `/api/v1/billing/balances?patientIds=${plain.id},${newId()},${owing.id},${plain.id}`,
      );
      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        { patientId: plain.id, balances: [] },
        { patientId: owing.id, balances: [{ amount: '12.50', currency: 'USD' }] },
      ]);

      expect((await main.owner.get('/api/v1/billing/balances')).status).toBe(400);
      expect((await main.owner.get('/api/v1/billing/balances?patientIds=nope')).status).toBe(400);
      const tooMany = Array.from({ length: 101 }, () => newId()).join(',');
      expect((await main.owner.get(`/api/v1/billing/balances?patientIds=${tooMany}`)).status).toBe(
        400,
      );
    });
  });

  describe('adjustments', () => {
    it('applies a signed adjustment with its reason, audited', async () => {
      const { patient } = await openWithBalance(main.owner, 'Adjusted', '250.00');
      const response = await adjust(main.owner, patient.id, {
        amount: '-50.00',
        effectiveDate: TODAY,
        reason: 'goodwill',
        note: 'Loyal patient',
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(response.body).toEqual({
        patientId: patient.id,
        balances: [{ amount: '200.00', currency: 'USD' }],
      });

      const entries = await auditOf(main.owner, 'resourceType=ledger_entry');
      const adjustment = entries.find(
        (entry) =>
          (entry.after as { patientId: string; kind: string }).patientId === patient.id &&
          (entry.after as { kind: string }).kind === 'adjustment',
      );
      expect(adjustment).toMatchObject({
        action: 'ledger_entry.create',
        reason: 'goodwill',
        after: { amount: '-50.00', reason: 'goodwill', note: 'Loyal patient' },
      });
    });

    it('requires a reason and a non-zero amount, and a date not after the tenant today', async () => {
      const { patient } = await openWithBalance(main.owner, 'Adjust Rules', '10.00');
      const noReason = await adjust(main.owner, patient.id, {
        amount: '-5.00',
        effectiveDate: TODAY,
      });
      expect(noReason.status).toBe(400);
      expect(firstPath(noReason.body)).toBe('reason');
      for (const amount of ['0', '0.00', '-0']) {
        const zero = await adjust(main.owner, patient.id, {
          amount,
          effectiveDate: TODAY,
          reason: 'nothing',
        });
        expect(zero.status, amount).toBe(400);
        expect(firstPath(zero.body)).toBe('amount');
      }
      const future = await adjust(main.owner, patient.id, {
        amount: '5.00',
        effectiveDate: '2026-06-11',
        reason: 'too early',
      });
      expect(future.status).toBe(422);
      expect(firstPath(future.body)).toBe('effectiveDate');

      const unknown = await adjust(main.owner, newId(), {
        amount: '5.00',
        effectiveDate: TODAY,
        reason: 'ghost',
      });
      expect(unknown.status).toBe(404);
      expect(unknown.body).toMatchObject({ code: 'patient.not_found' });
      expect(await balanceOf(main.owner, patient.id)).toMatchObject({
        balances: [{ amount: '10.00', currency: 'USD' }],
      });
    });

    it('stamps the tenant currency at write time and keeps each currency apart', async () => {
      const clinic = await provision('Currency Clinic');
      const { patient } = await openWithBalance(clinic.owner, 'Two Currencies', '250.00');
      expect((await clinic.owner.patch('/api/v1/tenant').send({ currency: 'EUR' })).status).toBe(
        200,
      );
      const response = await adjust(clinic.owner, patient.id, {
        amount: '30.00',
        effectiveDate: TODAY,
        reason: 'late fee',
      });
      expect(response.status).toBe(201);
      const expected = [
        { amount: '30.00', currency: 'EUR' },
        { amount: '250.00', currency: 'USD' },
      ];
      expect((response.body as PatientBalance).balances).toEqual(expected);
      expect((await balanceOf(clinic.owner, patient.id)).balances).toEqual(expected);
      expect((await ledgerRows(clinic.tenant.id)).map((row) => row.currency)).toEqual([
        'USD',
        'EUR',
      ]);
    });

    it('refuses a merged-away patient (409) but allows an archived one (write-off)', async () => {
      const kept = await createPatient(main.owner, 'Merge Kept');
      const dropped = (await openWithBalance(main.owner, 'Merge Dropped', '80.00')).patient;
      const merged = await main.owner
        .post('/api/v1/patients/merge')
        .send({ keepId: kept.id, dropId: dropped.id, reason: 'Same person' });
      expect(merged.status, JSON.stringify(merged.body)).toBe(200);
      const refused = await adjust(main.owner, dropped.id, {
        amount: '-80.00',
        effectiveDate: TODAY,
        reason: 'late write-off',
      });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: 'patient.merged' });
      // The merge job moves the dropped record's entry to the kept one; the refused one never exists.
      await vi.waitFor(
        async () => {
          expect(await balanceOf(main.owner, kept.id)).toMatchObject({
            balances: [{ amount: '80.00', currency: 'USD' }],
          });
        },
        { timeout: 15_000, interval: 100 },
      );
      expect(await balanceOf(main.owner, dropped.id)).toMatchObject({ balances: [] });

      const archived = (await openWithBalance(main.owner, 'Archived Debtor', '35.00')).patient;
      expect(
        (await main.owner.post('/api/v1/patients/archive').send({ ids: [archived.id] })).status,
      ).toBe(200);
      const writeOff = await adjust(main.owner, archived.id, {
        amount: '-35.00',
        effectiveDate: TODAY,
        reason: 'bad debt write-off',
      });
      expect(writeOff.status).toBe(201);
      expect(writeOff.body).toEqual({ patientId: archived.id, balances: [] });
    });

    it('returns sums wider than one numeric(12,2) amount', async () => {
      const { patient } = await openWithBalance(main.owner, 'Very Rich Debt', '9999999999.99');
      const response = await adjust(main.owner, patient.id, {
        amount: '9999999999.99',
        effectiveDate: TODAY,
        reason: 'second maximum entry',
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const wide = [{ amount: '19999999999.98', currency: 'USD' }];
      expect((response.body as PatientBalance).balances).toEqual(wide);
      expect((await balanceOf(main.owner, patient.id)).balances).toEqual(wide);
      const many = await main.owner.get(`/api/v1/billing/balances?patientIds=${patient.id}`);
      expect(many.status).toBe(200);
      expect(many.body).toEqual([{ patientId: patient.id, balances: wide }]);
    });

    it('records a platform admin acting in the tenant as the creator, flagged in the audit', async () => {
      const { patient } = await openWithBalance(main.owner, 'Admin Adjusted', '20.00');
      const adminId = ((await admin.get('/api/v1/session')).body as Session).user.id;
      const response = await admin
        .post(`/api/v1/billing/patients/${patient.id}/adjustments`)
        .set('X-Tenant-Id', main.tenant.id)
        .send({ amount: '-20.00', effectiveDate: TODAY, reason: 'support correction' });
      expect(response.status, JSON.stringify(response.body)).toBe(201);

      const entry = await database.ownerPool.query<{
        created_by: string;
        actor_user_id: string;
        actor_platform_admin: boolean;
        actor_kind: string;
      }>(
        `select e.created_by, a.actor_user_id, a.actor_platform_admin, a.actor_kind
         from ledger_entries e join audit_log a on a.resource_id = e.id::text
         where e.patient_id = $1 and e.kind = 'adjustment' and a.action = 'ledger_entry.create'`,
        [patient.id],
      );
      expect(entry.rows).toEqual([
        {
          created_by: adminId,
          actor_user_id: adminId,
          actor_platform_admin: true,
          actor_kind: 'user',
        },
      ]);
    });
  });

  describe('append-only entries (migration 0011)', () => {
    it('cannot be deleted, truncated or have their amount rewritten by the runtime roles', async () => {
      for (const pool of [database.appPool, database.adminPool]) {
        await expect(pool.query('update ledger_entries set amount = 1')).rejects.toThrow(
          /permission denied/,
        );
        await expect(pool.query('delete from ledger_entries')).rejects.toThrow(/permission denied/);
        await expect(pool.query('truncate ledger_entries')).rejects.toThrow(/permission denied/);
      }
    });

    it('lets only the app role move entries between patients (the merge re-point)', async () => {
      await expect(
        database.appPool.query(
          'update ledger_entries set patient_id = patient_id, updated_at = now() where false',
        ),
      ).resolves.toMatchObject({ rowCount: 0 });
      await expect(
        database.adminPool.query('update ledger_entries set patient_id = patient_id where false'),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('patientIdsOwing', () => {
    it('requires payment:read', async () => {
      const service = testApp.app.get(BillingService);
      await expect(
        testApp.app
          .get(RequestContext)
          .run(
            { requestId: newId(), actorKind: 'user', userId: newId(), tenantId: main.tenant.id },
            () => service.patientIdsOwing(),
          ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });

    it('lists patients owing in any currency; settled and credit balances are not owing', async () => {
      const clinic = await provision('Owing Clinic');
      const owing = (await openWithBalance(clinic.owner, 'Owing', '100.00')).patient;
      const settled = (await openWithBalance(clinic.owner, 'Settled', '50.00')).patient;
      const credit = (await openWithBalance(clinic.owner, 'Credit', '10.00')).patient;
      const mixed = (await openWithBalance(clinic.owner, 'Mixed', '5.00')).patient;
      await createPatient(clinic.owner, 'Nothing');
      for (const [patient, amount] of [
        [settled, '-50.00'],
        [credit, '-30.00'],
        [mixed, '-15.00'],
      ] as const) {
        const response = await adjust(clinic.owner, patient.id, {
          amount,
          effectiveDate: TODAY,
          reason: 'settle',
        });
        expect(response.status).toBe(201);
      }
      // Mixed: USD -10.00 (credit) but EUR 2.00 owed.
      await clinic.owner.patch('/api/v1/tenant').send({ currency: 'EUR' });
      await adjust(clinic.owner, mixed.id, { amount: '2.00', effectiveDate: TODAY, reason: 'fee' });

      const service = testApp.app.get(BillingService);
      const ids = await asPlatformAdminIn(testApp.app, clinic.tenant.id, () =>
        service.patientIdsOwing(),
      );
      expect([...ids].sort()).toEqual([owing.id, mixed.id].sort());
    });
  });

  describe('permissions', () => {
    let assistant: TestAgent;
    let frontdesk: TestAgent;
    let patient: Patient;

    beforeAll(async () => {
      assistant = await staffAgent(main, 'assistant');
      frontdesk = await staffAgent(main, 'frontdesk');
      patient = (await openWithBalance(main.owner, 'Permissions', '40.00')).patient;
    });

    it('the assistant reads balances but cannot record entries', async () => {
      const opening = await assistant.post('/api/v1/billing/opening-balances').send({
        patient: { fullName: 'By Assistant', phone: '71000000' },
        openingBalance: { amount: '10.00', asOf: TODAY },
      });
      expect(opening.status).toBe(403);
      const adjustment = await adjust(assistant, patient.id, {
        amount: '-5.00',
        effectiveDate: TODAY,
        reason: 'not allowed',
      });
      expect(adjustment.status).toBe(403);

      expect((await assistant.get(`/api/v1/billing/patients/${patient.id}/balance`)).status).toBe(
        200,
      );
      expect(
        (await assistant.get(`/api/v1/billing/balances?patientIds=${patient.id}`)).status,
      ).toBe(200);
      expect(await patientNames(main.tenant.id)).not.toContain('By Assistant');
    });

    it('front desk records opening balances and adjustments', async () => {
      const { balance } = await openWithBalance(frontdesk, 'By Front Desk', '15.00');
      expect(balance.balances).toEqual([{ amount: '15.00', currency: 'USD' }]);
      const adjustment = await adjust(frontdesk, patient.id, {
        amount: '-5.00',
        effectiveDate: TODAY,
        reason: 'discount',
      });
      expect(adjustment.status).toBe(201);
    });
  });
});
