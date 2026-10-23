import type { Patient, PlatformAuditPage } from '@dcm/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { ok, provisionClinic, type TestClinic } from '../support/clinic';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createTestApp, type TestApp } from '../support/test-app';

/** Every clinic's Activity for platform admins (ADR-0057). Other files write rows too (one shared
 * database), so the assertions look at this file's clinics. */
describe('audit: the platform Activity across clinics (ADR-0057)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let alpha: TestClinic;
  let bravo: TestClinic;

  const createPatient = (clinic: TestClinic, fullName: string) =>
    ok<Patient>(
      clinic.owner.post('/api/v1/patients').set('Idempotency-Key', newId()).send({ fullName }),
      201,
    );

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    alpha = await provisionClinic(testApp, 'Alpha Activity');
    bravo = await provisionClinic(testApp, 'Bravo Activity');
    await createPatient(alpha, 'Alma Alpha');
    await createPatient(bravo, 'Bruno Bravo');
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('shows a platform admin every clinic’s feed, each row with its clinic, newest first', async () => {
    const page = await ok<PlatformAuditPage>(alpha.admin.get('/api/v1/platform/audit?limit=100'));
    const tenants = new Set(page.items.map((item) => item.tenantId));
    expect(tenants.size).toBeGreaterThan(1);
    expect(page.items.every((item) => item.area !== null)).toBe(true);
    const times = page.items.map((item) => item.occurredAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it('narrows to one clinic, and pages with a cursor', async () => {
    const first = await ok<PlatformAuditPage>(
      alpha.admin.get(`/api/v1/platform/audit?tenantId=${bravo.tenant.id}&limit=1`),
    );
    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.tenantId).toBe(bravo.tenant.id);
    expect(first.nextCursor).not.toBeNull();
    const next = await ok<PlatformAuditPage>(
      alpha.admin.get(
        `/api/v1/platform/audit?tenantId=${bravo.tenant.id}&limit=50&cursor=${first.nextCursor ?? ''}`,
      ),
    );
    expect(next.items.every((item) => item.tenantId === bravo.tenant.id)).toBe(true);
    expect(next.items.map((item) => item.id)).not.toContain(first.items[0]?.id);

    const patients = await ok<PlatformAuditPage>(
      alpha.admin.get(`/api/v1/platform/audit?tenantId=${alpha.tenant.id}&area=patients`),
    );
    expect(patients.items.map((item) => item.action)).toContain('patient.create');
    expect(patients.items.every((item) => item.tenantId === alpha.tenant.id)).toBe(true);
  });

  it('is the platform admin’s alone', async () => {
    expect((await alpha.owner.get('/api/v1/platform/audit')).status).toBe(403);
  });
});
