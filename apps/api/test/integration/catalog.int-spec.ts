import {
  type AuditPage,
  type Branch,
  type CatalogSeedResult,
  type DiagnosisItem,
  leastUsedMarkColor,
  type ProblemDetails,
  type ServiceItem,
  type Tenant,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn, signInAndSetPassword, uniqueEmail } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

const TEMPORARY = 'temporary-pw-1';

const input = (item: ServiceItem) => ({
  id: item.id,
  code: item.code,
  name: item.name,
  category: item.category,
  chargeUnit: item.chargeUnit,
  price: item.price.amount,
  frequent: item.frequent,
  active: item.active,
});

describe('clinical: service and diagnosis catalogs', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;
  let tenant: Tenant;
  let frontdesk: TestAgent;

  const api = {
    get: (path: string) => admin.get(`/api/v1${path}`).set('X-Tenant-Id', tenant.id),
    put: (path: string, body: object) =>
      admin.put(`/api/v1${path}`).set('X-Tenant-Id', tenant.id).send(body),
    post: (path: string, body: object = {}) =>
      admin.post(`/api/v1${path}`).set('X-Tenant-Id', tenant.id).send(body),
    patch: (path: string, body: object) =>
      admin.patch(`/api/v1${path}`).set('X-Tenant-Id', tenant.id).send(body),
    delete: (path: string) => admin.delete(`/api/v1${path}`).set('X-Tenant-Id', tenant.id),
  };
  const services = async () => (await api.get('/catalog/services')).body as ServiceItem[];
  const diagnoses = async () => (await api.get('/catalog/diagnoses')).body as DiagnosisItem[];
  const service = async (code: string) => {
    const found = (await services()).find((item) => item.code === code);
    if (!found) throw new Error(`no service ${code}`);
    return found;
  };
  const auditOf = async (query: string) =>
    ((await api.get(`/audit?${query}&limit=100`)).body as AuditPage).items;

  const provision = async (name: string) => {
    const ownerEmail = uniqueEmail('owner');
    const response = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name, slug: `cat-${newId().slice(-12)}` },
      firstBranch: { name: 'Main St' },
      owner: { displayName: `${name} Owner`, email: ownerEmail, temporaryPassword: TEMPORARY },
    });
    expect(response.status).toBe(201);
    return { tenant: response.body as Tenant, ownerEmail };
  };

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    ({ tenant } = await provision('Catalog Clinic'));

    const [branch] = (await api.get('/branches')).body as Branch[];
    const email = uniqueEmail('frontdesk');
    const created = await api.post('/users', {
      displayName: 'Jamie Ortiz',
      email,
      practitionerType: 'frontdesk',
      roleKeys: ['frontdesk'],
      branchIds: [branch?.id],
      temporaryPassword: TEMPORARY,
    });
    expect(created.status).toBe(201);
    frontdesk = await signInAndSetPassword(testApp.app, email, TEMPORARY);
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('default template', () => {
    it('is seeded on provisioning, in POC order, in the tenant currency, by the system', async () => {
      const seeded = await services();
      expect(seeded).toHaveLength(13);
      expect(seeded.map((item) => item.code).slice(0, 4)).toEqual(['EXT', 'CLT', 'PARO', 'PARX']);
      expect(seeded[0]).toMatchObject({
        name: 'Extraction',
        category: 'Surgical',
        chargeUnit: 'per_tooth',
        price: { amount: '30.00', currency: 'USD' },
        frequent: true,
        active: true,
      });
      expect(seeded.find((item) => item.code === 'XRY')?.active).toBe(false);

      const dx = await diagnoses();
      expect(dx).toHaveLength(14);
      expect(dx[0]).toMatchObject({ code: 'DX-CAR', name: 'Dental caries', frequent: true });

      const created = await auditOf('resourceType=procedure');
      expect(created.filter((entry) => entry.action === 'catalog.service.create')).toHaveLength(13);
      expect(created[0]).toMatchObject({ actorKind: 'system', actorPlatformAdmin: false });
    });

    it('is a no-op to seed again while the catalog has rows', async () => {
      const response = await api.post('/catalog/seed-default');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ services: 0, diagnoses: 0 } satisfies CatalogSeedResult);
      expect(await services()).toHaveLength(13);
    });

    it('seeds a tenant whose catalogs are empty', async () => {
      const other = await provision('Emptied Clinic');
      const inOther = {
        get: (path: string) => admin.get(`/api/v1${path}`).set('X-Tenant-Id', other.tenant.id),
        post: (path: string) => admin.post(`/api/v1${path}`).set('X-Tenant-Id', other.tenant.id),
        delete: (path: string) =>
          admin.delete(`/api/v1${path}`).set('X-Tenant-Id', other.tenant.id),
      };
      for (const kind of ['services', 'diagnoses']) {
        for (const item of (await inOther.get(`/catalog/${kind}`)).body as { id: string }[]) {
          expect((await inOther.delete(`/catalog/${kind}/${item.id}`)).status).toBe(204);
        }
      }

      const seeded = await inOther.post('/catalog/seed-default');
      expect(seeded.body).toEqual({ services: 13, diagnoses: 14 });
      expect((await inOther.get('/catalog/services')).body).toHaveLength(13);
    });
  });

  describe('batch save', () => {
    it('creates and updates rows in one call and returns the whole catalog', async () => {
      const ext = await service('EXT');
      const response = await api.put('/catalog/services', {
        items: [
          {
            code: 'impl',
            name: 'Implant consult',
            category: 'Implants',
            chargeUnit: 'per_jaw',
            price: '45.5',
          },
          { ...input(ext), name: 'Simple extraction', frequent: false },
        ],
      });
      expect(response.status).toBe(200);
      const saved = response.body as ServiceItem[];
      expect(saved).toHaveLength(14);
      expect(saved.at(-1)).toMatchObject({
        code: 'IMPL',
        name: 'Implant consult',
        category: 'Implants',
        price: { amount: '45.50', currency: 'USD' },
        frequent: false,
        active: true,
      });
      expect(saved.find((item) => item.id === ext.id)).toMatchObject({
        name: 'Simple extraction',
        frequent: false,
      });

      const [entry] = await auditOf(`resourceId=${ext.id}`);
      expect(entry).toMatchObject({
        action: 'catalog.service.update',
        resourceType: 'procedure',
        actorKind: 'user',
        actorPlatformAdmin: true,
        before: { name: 'Extraction', frequent: true },
        after: { name: 'Simple extraction', frequent: false },
      });
      const changed = (await auditOf('resourceType=event')).find(
        (item) => item.action === 'CatalogChanged',
      );
      expect(changed?.after).toEqual({
        kind: 'service',
        ids: expect.arrayContaining([ext.id]) as unknown,
      });
    });

    it('lets two rows swap codes', async () => {
      const [cmp, cgic] = [await service('CMP'), await service('CGIC')];
      const response = await api.put('/catalog/services', {
        items: [
          { ...input(cmp), code: 'CGIC' },
          { ...input(cgic), code: 'CMP' },
        ],
      });
      expect(response.status).toBe(200);
      expect((await service('CMP')).id).toBe(cgic.id);
      expect((await service('CGIC')).id).toBe(cmp.id);
    });

    it('rejects a duplicate code with 422 and the row path, saving nothing', async () => {
      const response = await api.put('/catalog/services', {
        items: [
          { code: 'NEW1', name: 'New one', category: null, chargeUnit: 'per_tooth', price: '1' },
          {
            code: 'zir',
            name: 'Another zircon',
            category: null,
            chargeUnit: 'per_tooth',
            price: '1',
          },
        ],
      });
      expect(response.status).toBe(422);
      const problem = response.body as ProblemDetails;
      expect(problem.code).toBe('validation_failed');
      expect(problem.errors).toEqual([
        {
          path: 'items.1.code',
          code: 'duplicate',
          message: 'Code ZIR is already used by "Zircon crown"',
        },
      ]);
      expect((await services()).some((item) => item.code === 'NEW1')).toBe(false);
    });

    it('rejects a blank name at request validation with the row path', async () => {
      const response = await api.put('/catalog/services', {
        items: [{ code: 'X1', name: ' ', category: null, chargeUnit: 'per_tooth', price: '1' }],
      });
      expect(response.status).toBe(400);
      expect((response.body as ProblemDetails).errors?.[0]?.path).toBe('items.0.name');
    });

    it('answers 404 for an unknown row', async () => {
      const response = await api.put('/catalog/diagnoses', {
        items: [{ id: newId(), code: 'DX-X', name: 'Unknown', category: null }],
      });
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 'catalog.not_found' });
    });

    it('stamps the tenant currency when the price changes, and only then', async () => {
      expect((await api.patch('/tenant', { currency: 'EUR' })).status).toBe(200);
      try {
        const [scl, onl] = [await service('SCL'), await service('ONL')];
        await api.put('/catalog/services', {
          items: [
            { ...input(scl), name: 'Scaling and polishing' },
            { ...input(onl), price: '260' },
          ],
        });
        expect((await service('SCL')).price).toEqual({ amount: '60.00', currency: 'USD' });
        expect((await service('ONL')).price).toEqual({ amount: '260.00', currency: 'EUR' });
      } finally {
        await api.patch('/tenant', { currency: 'USD' });
      }
    });

    it('saves diagnoses and rejects their duplicate codes too', async () => {
      const response = await api.put('/catalog/diagnoses', {
        items: [{ code: 'dx-abs', name: 'Periapical abscess', category: 'Pulpal', frequent: true }],
      });
      expect(response.status).toBe(200);
      expect((response.body as DiagnosisItem[]).at(-1)).toMatchObject({
        code: 'DX-ABS',
        frequent: true,
        active: true,
      });

      const duplicate = await api.put('/catalog/diagnoses', {
        items: [{ code: 'DX-GIN', name: 'Gingivitis again', category: null }],
      });
      expect(duplicate.status).toBe(422);
      expect((duplicate.body as ProblemDetails).errors?.[0]?.path).toBe('items.0.code');
    });
  });

  describe('chart marks (feature 9)', () => {
    it('seeds a colour on every diagnosis and per-tooth service, and icons where one fits', async () => {
      const seeded = await services();
      expect(seeded.find((item) => item.code === 'IMP')).toMatchObject({
        color: 'green',
        icon: 'implant',
        markPriority: 5,
      });
      expect(seeded.find((item) => item.code === 'SCL')).toMatchObject({ color: null, icon: null });
      expect((await diagnoses()).find((item) => item.code === 'DX-CAR')).toMatchObject({
        color: 'rose',
        markPriority: 5,
      });
    });

    it('gives new rows the least used colours, and none to a service off the tooth', async () => {
      const before = await services();
      const first = leastUsedMarkColor(before.map((item) => item.color));
      const second = leastUsedMarkColor([...before.map((item) => item.color), first]);
      const response = await api.put('/catalog/services', {
        items: [
          { code: 'MK1', name: 'Mark one', chargeUnit: 'per_tooth', price: '1' },
          { code: 'MK2', name: 'Mark two', chargeUnit: 'per_tooth', price: '1' },
          {
            code: 'MKJ',
            name: 'Mark jaw',
            chargeUnit: 'per_jaw',
            price: '1',
            color: 'pink',
            icon: 'denture',
            markPriority: 9,
          },
        ],
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const saved = response.body as ServiceItem[];
      const byCode = (code: string) => saved.find((item) => item.code === code);
      expect(byCode('MK1')).toMatchObject({ color: first, icon: null, markPriority: 5 });
      expect(byCode('MK2')).toMatchObject({ color: second, icon: null });
      expect(first).not.toBe(second);
      expect(byCode('MKJ')).toMatchObject({ color: null, icon: null, markPriority: 9 });

      const dx = await api.put('/catalog/diagnoses', {
        items: [{ code: 'DX-MK', name: 'Marked diagnosis' }],
      });
      expect(dx.status, JSON.stringify(dx.body)).toBe(200);
      const all = dx.body as DiagnosisItem[];
      const created = all.find((item) => item.code === 'DX-MK');
      expect(created?.color).toBe(
        leastUsedMarkColor(all.filter((item) => item !== created).map((item) => item.color)),
      );
    });

    it('keeps a mark that is not sent, changes one that is, and audits it', async () => {
      const cmp = await service('MK1');
      await api.put('/catalog/services', {
        items: [{ ...input(cmp), color: 'blue', icon: 'filling' }],
      });
      const kept = await api.put('/catalog/services', {
        items: [{ ...input(cmp), name: 'Mark one, renamed' }],
      });
      expect((kept.body as ServiceItem[]).find((item) => item.id === cmp.id)).toMatchObject({
        name: 'Mark one, renamed',
        color: 'blue',
        icon: 'filling',
        markPriority: 5,
      });

      const changed = await api.put('/catalog/services', {
        items: [{ ...input(cmp), color: 'magenta', icon: null, markPriority: 8 }],
      });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      expect((changed.body as ServiceItem[]).find((item) => item.id === cmp.id)).toMatchObject({
        color: 'magenta',
        icon: null,
        markPriority: 8,
      });
      const [entry] = await auditOf(`resourceId=${cmp.id}`);
      expect(entry).toMatchObject({
        action: 'catalog.service.update',
        before: { color: 'blue', icon: 'filling', markPriority: 5 },
        after: { color: 'magenta', icon: null, markPriority: 8 },
      });

      // Off the tooth it keeps its mark, for the tooth records it already has; what is sent
      // for it is ignored. Back on a tooth it is as it was.
      const offTooth = await api.put('/catalog/services', {
        items: [{ ...input(cmp), chargeUnit: 'per_mouth', color: 'lime', icon: 'crown' }],
      });
      expect(offTooth.status, JSON.stringify(offTooth.body)).toBe(200);
      expect((offTooth.body as ServiceItem[]).find((item) => item.id === cmp.id)).toMatchObject({
        chargeUnit: 'per_mouth',
        color: 'magenta',
        icon: null,
      });
      const onTooth = await api.put('/catalog/services', { items: [input(cmp)] });
      expect((onTooth.body as ServiceItem[]).find((item) => item.id === cmp.id)).toMatchObject({
        chargeUnit: 'per_tooth',
        color: 'magenta',
      });

      const refused = await api.put('/catalog/services', {
        items: [{ ...input(cmp), color: '#ff00ff' }],
      });
      expect(refused.status).toBe(400);
    });
  });

  describe('delete and deactivate', () => {
    it('soft-deletes an unused row, audits it and frees its code', async () => {
      const clt = await service('CLT');
      expect((await api.delete(`/catalog/services/${clt.id}`)).status).toBe(204);
      expect((await services()).some((item) => item.id === clt.id)).toBe(false);

      const [entry] = await auditOf(`resourceId=${clt.id}`);
      expect(entry).toMatchObject({ action: 'catalog.service.delete', before: { code: 'CLT' } });

      const reused = await api.put('/catalog/services', {
        items: [
          {
            code: 'CLT',
            name: 'Crown lengthening',
            category: 'Surgical',
            chargeUnit: 'per_tooth',
            price: '15',
          },
        ],
      });
      expect(reused.status).toBe(200);
      expect((await api.delete(`/catalog/services/${clt.id}`)).status).toBe(404);
    });

    it('refuses to delete a row a record uses (409 catalog.in_use) and keeps it', async () => {
      // Records written directly: a live visit with a service, a plan and a diagnosis record.
      const visitId = newId();
      const patientId = newId();
      await database.ownerPool.query(
        `insert into visits (id, tenant_id, display_number, patient_id, branch_id, dentist_id,
                             started_by, status, local_date, started_at, currency)
         values ($1, $2, (select coalesce(max(display_number), 0) + 1 from visits where tenant_id = $2),
                 $3, $4, $5, $6, 'in_progress', '2026-06-10', now(), 'USD')`,
        [visitId, tenant.id, patientId, newId(), newId(), newId()],
      );
      const paro = await service('PARO');
      const mcc = await service('MCC');
      const zir = await service('ZIR');
      const pulp = (await diagnoses()).find((item) => item.code === 'DX-PULP');
      if (!pulp) throw new Error('no diagnosis DX-PULP');
      const recordedBy = newId();
      const serviceRow = (item: ServiceItem, deleted: boolean) =>
        database.ownerPool.query(
          `insert into visit_services (id, tenant_id, visit_id, procedure_id, code, name,
                                       charge_unit, tooth_code, base_amount, recorded_by, deleted_at)
           values ($1, $2, $3, $4, $5, $6, 'per_tooth', '16', 30, $7, case when $8 then now() end)`,
          [newId(), tenant.id, visitId, item.id, item.code, item.name, recordedBy, deleted],
        );
      await serviceRow(paro, false);
      await serviceRow(zir, true);
      await database.ownerPool.query(
        `insert into treatment_plans (id, tenant_id, patient_id, tooth_code, procedure_id, code, name,
                                      charge_unit, price_amount, price_currency, dentist_id,
                                      recorded_by, recorded_in_visit_id, recorded_at)
         values ($1, $2, $3, '16', $4, $5, $6, 'per_tooth', 250, 'USD', $7, $8, $9, now())`,
        [newId(), tenant.id, patientId, mcc.id, mcc.code, mcc.name, newId(), recordedBy, visitId],
      );
      await database.ownerPool.query(
        `insert into patient_diagnoses (id, tenant_id, patient_id, tooth_code, diagnosis_id, code,
                                        name, dentist_id, recorded_by, recorded_in_visit_id,
                                        recorded_at)
         values ($1, $2, $3, '16', $4, $5, $6, $7, $8, $9, now())`,
        [
          newId(),
          tenant.id,
          patientId,
          pulp.id,
          pulp.code,
          pulp.name,
          newId(),
          recordedBy,
          visitId,
        ],
      );

      for (const path of [
        `/catalog/services/${paro.id}`,
        `/catalog/services/${mcc.id}`,
        `/catalog/diagnoses/${pulp.id}`,
      ]) {
        const response = await api.delete(path);
        expect(response.status, path).toBe(409);
        expect(response.body, path).toMatchObject({ code: 'catalog.in_use' });
      }
      expect((await service('PARO')).id).toBe(paro.id);
      expect((await service('MCC')).id).toBe(mcc.id);
      expect((await diagnoses()).some((item) => item.id === pulp.id)).toBe(true);
      // Only a removed service names ZIR: nothing keeps it.
      expect((await api.delete(`/catalog/services/${zir.id}`)).status).toBe(204);
    });

    it('waits for a record being written with the row, then refuses (409 catalog.in_use)', async () => {
      const saved = await api.put('/catalog/services', {
        items: [{ code: 'ZLOCK', name: 'Locked service', chargeUnit: 'per_tooth', price: '20' }],
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      const item = await service('ZLOCK');
      const visitId = newId();
      await database.ownerPool.query(
        `insert into visits (id, tenant_id, display_number, patient_id, branch_id, dentist_id,
                             started_by, status, local_date, started_at, currency)
         values ($1, $2, (select coalesce(max(display_number), 0) + 1 from visits where tenant_id = $2),
                 $3, $4, $5, $6, 'in_progress', '2026-06-10', now(), 'USD')`,
        [visitId, tenant.id, newId(), newId(), newId(), newId()],
      );

      // A service being added in another transaction: the row read FOR KEY SHARE, the line in.
      const holder = await database.ownerPool.connect();
      try {
        await holder.query('begin');
        await holder.query("select set_config('app.tenant_id', $1, true)", [tenant.id]);
        await holder.query('select id from procedures where id = $1 for key share', [item.id]);
        await holder.query(
          `insert into visit_services (id, visit_id, procedure_id, code, name, charge_unit,
                                       tooth_code, base_amount, recorded_by)
           values ($1, $2, $3, $4, $5, 'per_tooth', '16', 20, $6)`,
          [newId(), visitId, item.id, item.code, item.name, newId()],
        );
        const {
          rows: [backend],
        } = await holder.query<{ pid: number }>('select pg_backend_pid() as pid');
        if (!backend) throw new Error('no backend pid');
        let settled = false;
        const pending = api.delete(`/catalog/services/${item.id}`).then((response) => {
          settled = true;
          return response;
        });
        // The delete's FOR UPDATE waits on the holder's FOR KEY SHARE.
        await expect
          .poll(
            async () =>
              (
                await database.ownerPool.query<{ n: number }>(
                  `select count(*)::int as n from pg_stat_activity
                   where $1 = any(pg_blocking_pids(pid))`,
                  [backend.pid],
                )
              ).rows[0]?.n,
          )
          .toBe(1);
        expect(settled).toBe(false);
        await holder.query('commit');

        const response = await pending;
        expect(response.status, JSON.stringify(response.body)).toBe(409);
        expect(response.body).toMatchObject({ code: 'catalog.in_use' });
      } catch (error) {
        await holder.query('rollback');
        throw error;
      } finally {
        holder.release();
      }
      expect((await service('ZLOCK')).id).toBe(item.id);
    });

    it('marks a row inactive', async () => {
      const dx = (await diagnoses()).find((item) => item.code === 'DX-ATTR');
      const response = await api.post(`/catalog/diagnoses/${dx?.id ?? ''}/deactivate`);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ code: 'DX-ATTR', active: false });
      const [entry] = await auditOf(`resourceId=${dx?.id ?? ''}`);
      expect(entry).toMatchObject({
        action: 'catalog.diagnosis.deactivate',
        before: { active: true },
        after: { active: false },
      });
    });
  });

  describe('permissions', () => {
    it('lets the front desk read but not change the catalog', async () => {
      const listed = await frontdesk.get('/api/v1/catalog/services');
      expect(listed.status).toBe(200);
      expect((listed.body as ServiceItem[]).length).toBeGreaterThan(0);
      expect((await frontdesk.get('/api/v1/catalog/diagnoses')).status).toBe(200);

      const ext = await service('EXT');
      const attempts = [
        frontdesk.put('/api/v1/catalog/services').send({ items: [input(ext)] }),
        frontdesk.delete(`/api/v1/catalog/services/${ext.id}`),
        frontdesk.post(`/api/v1/catalog/services/${ext.id}/deactivate`),
        frontdesk.post('/api/v1/catalog/seed-default'),
      ];
      for (const response of await Promise.all(attempts)) {
        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ code: 'forbidden' });
      }
      expect((await service('EXT')).active).toBe(true);
    });
  });
});
