import {
  type AuditEntry,
  type AuditPage,
  type Branch,
  type FileDownload,
  MAX_FILE_BYTES,
  type Patient,
  type PatientFile,
  type PatientFiles,
  type ProblemDetails,
  type StaffUser,
  type StartVisitResult,
  type Tenant,
  type UploadTarget,
  type Visit,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { FakeObjectStorage, sampleStart } from '../support/fake-storage';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn, signInAndSetPassword, uniqueEmail } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

const TEMPORARY = 'temporary-pw-1';

/** Beirut is UTC+3 in June: the tenant's today is 2026-06-10 all day at this instant. */
const NOON = '2026-06-10T09:00:00Z';

interface Staff {
  agent: TestAgent;
  user: StaffUser;
}

const problem = (body: unknown) => body as ProblemDetails;

/**
 * Feature 8: a patient's images and documents — the upload handshake and Save, the one read, the
 * edits, who may archive (F13), the visit link, the download, and the merge re-point. Object
 * storage is faked: a test "uploads" by putting a size and the file's first bytes under the
 * upload key.
 */
describe('files: upload, read, edit, archive and merge', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let storage: FakeObjectStorage;
  let tenant: Tenant;
  let owner: TestAgent;
  let branch: Branch;
  let dentist: Staff;
  let assistant: Staff;

  const createStaff = async (role: 'dentist' | 'assistant'): Promise<Staff> => {
    const email = uniqueEmail(role);
    const response = await owner.post('/api/v1/users').send({
      displayName: `${role} ${newId().slice(-6)}`,
      email,
      practitionerType: role,
      roleKeys: [role],
      branchIds: [branch.id],
      temporaryPassword: TEMPORARY,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return {
      agent: await signInAndSetPassword(testApp.app, email, TEMPORARY),
      user: response.body as StaffUser,
    };
  };

  const createPatient = async (fullName: string): Promise<Patient> => {
    const response = await owner
      .post('/api/v1/patients')
      .set('Idempotency-Key', newId())
      .send({ fullName, phone: '71 000 000', dateOfBirth: '1990-01-01' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Patient;
  };

  const startVisit = async (patient: Patient): Promise<Visit> => {
    const response = await dentist.agent
      .post('/api/v1/visits')
      .send({ patientId: patient.id, dentistId: dentist.user.profileId });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return (response.body as StartVisitResult).visit;
  };

  const ok = async <TResult>(
    request: Promise<{ status: number; body: unknown }>,
    status = 200,
  ): Promise<TResult> => {
    const response = await request;
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    return response.body as TResult;
  };

  const expectProblem = async (
    request: Promise<{ status: number; body: unknown }>,
    status: number,
    code: string,
  ) => {
    const response = await request;
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(problem(response.body).code).toBe(code);
    return problem(response.body);
  };

  /** Where a saved file's objects are — under a folder of the Save that sealed them — and where
   * the browser uploads them before Save. */
  const sealedPrefix = (id: string) => `tenants/${tenant.id}/files/${id}/`;
  const sealedKey = (id: string) => new RegExp(`^${sealedPrefix(id)}[0-9a-f-]{36}/original$`);
  const sibling = (storageKey: string, name: string) =>
    `${storageKey.slice(0, storageKey.lastIndexOf('/'))}/${name}`;
  const uploadKeyOf = (id: string, name = 'original') =>
    `tenants/${tenant.id}/uploads/${id}/${name}`;

  /** Asks where to upload, then "uploads" the bytes. */
  const upload = async (
    agent: TestAgent,
    patient: Patient,
    file: { filename: string; mimeType?: string; sizeBytes?: number; preview?: boolean },
  ): Promise<UploadTarget> => {
    const sizeBytes = file.sizeBytes ?? 2048;
    const target = await ok<UploadTarget>(
      agent.post('/api/v1/files/uploads').send({
        patientId: patient.id,
        filename: file.filename,
        mimeType: file.mimeType ?? '',
        sizeBytes,
        preview: file.preview ?? false,
      }),
      201,
    );
    storage.put(uploadKeyOf(target.id), sizeBytes, sampleStart(file.filename));
    if (file.preview) {
      storage.put(uploadKeyOf(target.id, 'display.jpg'), 900);
      storage.put(uploadKeyOf(target.id, 'thumb.jpg'), 90);
    }
    return target;
  };

  const save = (agent: TestAgent, patient: Patient, files: Record<string, unknown>[]) =>
    agent.post('/api/v1/files').send({ patientId: patient.id, files });

  /** One saved X-ray of `patient`, uploaded by `agent`. */
  const savedFile = async (
    agent: TestAgent,
    patient: Patient,
    fields: Record<string, unknown> = {},
  ): Promise<PatientFile> => {
    const target = await upload(agent, patient, { filename: 'pano.jpg', preview: true });
    const saved = await ok<PatientFiles>(
      save(agent, patient, [{ id: target.id, category: 'xray', ...fields }]),
      201,
    );
    const [file] = saved.items;
    if (!file) throw new Error('save returned no file');
    return file;
  };

  const listOf = async (agent: TestAgent, patient: Patient) =>
    (await ok<PatientFiles>(agent.get(`/api/v1/files?patientId=${patient.id}`))).items;

  const auditOf = async (fileId: string): Promise<AuditEntry[]> =>
    (
      (await owner.get(`/api/v1/audit?resourceType=file&resourceId=${fileId}&limit=100`))
        .body as AuditPage
    ).items;

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(new Date(NOON));
    storage = testApp.app.get(FakeObjectStorage);
    const admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    const ownerEmail = uniqueEmail('owner');
    const provisioned = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name: 'Files Clinic', slug: `fil-${newId().slice(-12)}` },
      firstBranch: { name: 'Files Main' },
      owner: { displayName: 'Files Owner', email: ownerEmail, temporaryPassword: TEMPORARY },
    });
    expect(provisioned.status, JSON.stringify(provisioned.body)).toBe(201);
    tenant = provisioned.body as Tenant;
    owner = await signInAndSetPassword(testApp.app, ownerEmail, TEMPORARY);
    const [first] = (await owner.get('/api/v1/branches')).body as Branch[];
    if (!first) throw new Error('provisioning created no branch');
    branch = first;
    dentist = await createStaff('dentist');
    assistant = await createStaff('assistant');
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('uploads, saves and lists a file with signed URLs', async () => {
    const patient = await createPatient('Rami Khoury');
    const target = await ok<UploadTarget>(
      assistant.agent.post('/api/v1/files/uploads').send({
        patientId: patient.id,
        filename: 'IMG_0042.JPG',
        mimeType: 'image/jpeg',
        sizeBytes: 4096,
        preview: true,
      }),
      201,
    );
    expect(target.mimeType).toBe('image/jpeg');
    expect(target.uploadUrl).toContain(`/${uploadKeyOf(target.id)}?`);
    expect(target.displayUploadUrl).toContain(`/${uploadKeyOf(target.id, 'display.jpg')}?`);
    expect(target.thumbnailUploadUrl).toContain(`/${uploadKeyOf(target.id, 'thumb.jpg')}?`);

    // A pending upload is no file yet, and Save waits for the bytes.
    expect(await listOf(assistant.agent, patient)).toEqual([]);
    const item = {
      id: target.id,
      category: 'photo',
      subCategory: 'intraoral',
      toothCode: '36',
      note: 'pre-op',
      exifTakenAt: '2026-03-12T10:42:00',
    };
    await expectProblem(save(assistant.agent, patient, [item]), 409, 'file.upload_incomplete');

    storage.put(uploadKeyOf(target.id), 5000);
    // The original is there but its previews are not.
    await expectProblem(save(assistant.agent, patient, [item]), 409, 'file.upload_incomplete');
    expect(storage.keysUnder(sealedPrefix(target.id))).toEqual([]);
    storage.put(uploadKeyOf(target.id, 'display.jpg'), 900);
    storage.put(uploadKeyOf(target.id, 'thumb.jpg'), 90);
    const saved = await ok<PatientFiles>(save(assistant.agent, patient, [item]), 201);
    expect(saved.items).toHaveLength(1);
    expect(saved.items[0]).toMatchObject({
      id: target.id,
      patientId: patient.id,
      kind: 'image',
      category: 'photo',
      subCategory: 'intraoral',
      toothCode: '36',
      visit: null,
      note: 'pre-op',
      originalFilename: 'IMG_0042.JPG',
      // What is stored, not what the browser announced.
      sizeBytes: 5000,
      orientation: 0,
      // The camera's wall time, read in Beirut (UTC+2 in March).
      takenAt: '2026-03-12T08:42:00.000Z',
      uploadedBy: assistant.user.id,
      uploadedByName: assistant.user.displayName,
      uploadedAt: new Date(NOON).toISOString(),
      archivedAt: null,
      // The storage location is for owners and platform admins.
      storageKey: null,
    });
    expect(saved.items[0]?.thumbnailUrl).toContain('thumb.jpg?');
    expect(saved.items[0]?.viewUrl).toContain('display.jpg?');
    expect(saved.items[0]?.viewUrl).toContain('X-Amz-Expires=900');

    const [listed] = await listOf(owner, patient);
    expect(listed?.id).toBe(target.id);
    // Save moved the objects to keys no upload URL was signed for.
    const storageKey = listed?.storageKey ?? '';
    expect(storageKey).toMatch(sealedKey(target.id));
    for (const name of ['original', 'display.jpg', 'thumb.jpg']) {
      expect(storage.has(sibling(storageKey, name))).toBe(true);
      expect(storage.has(uploadKeyOf(target.id, name))).toBe(false);
    }
    expect(storage.keysUnder(sealedPrefix(target.id))).toHaveLength(3);

    // Saved once: the same upload cannot be saved again.
    await expectProblem(save(assistant.agent, patient, [item]), 404, 'file.not_found');

    const [entry] = await auditOf(target.id);
    expect(entry).toMatchObject({
      action: 'file.upload',
      area: 'files',
      patientId: patient.id,
      actorUserId: assistant.user.id,
    });
    expect(entry?.after).toMatchObject({ category: 'photo', toothCode: '36' });
  });

  it('refuses what is not an accepted file', async () => {
    const patient = await createPatient('Type Check');
    const intent = (filename: string, mimeType: string, sizeBytes = 100) =>
      owner
        .post('/api/v1/files/uploads')
        .send({ patientId: patient.id, filename, mimeType, sizeBytes, preview: false });
    const dicom = await expectProblem(intent('series.dcm', ''), 422, 'file.type_unsupported');
    expect(dicom.detail).toBe('DICOM files are not supported');
    const other = await expectProblem(
      intent('clip.mp4', 'video/mp4'),
      422,
      'file.type_unsupported',
    );
    expect(other.detail).toBe('File type not supported');
    expect((await intent('big.pdf', 'application/pdf', MAX_FILE_BYTES + 1)).status).toBe(400);
    await expectProblem(
      owner.post('/api/v1/files/uploads').send({
        patientId: newId(),
        filename: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        preview: false,
      }),
      404,
      'patient.not_found',
    );

    // A stored object over the limit, whatever the browser claimed.
    const target = await upload(owner, patient, { filename: 'referral.pdf' });
    storage.put(uploadKeyOf(target.id), MAX_FILE_BYTES + 1, sampleStart('referral.pdf'));
    await expectProblem(
      save(owner, patient, [{ id: target.id, category: 'other' }]),
      422,
      'file.too_large',
    );

    // Bytes that are not what the name says: a page passed off as a PDF.
    const page = Uint8Array.from('<html><script>', (character) => character.charCodeAt(0));
    storage.put(uploadKeyOf(target.id), 1000, page);
    const disguised = await expectProblem(
      save(owner, patient, [{ id: target.id, category: 'other' }]),
      422,
      'file.type_unsupported',
    );
    expect(disguised.detail).toBe('This file is not the type its name says');
    // A refused Save keeps none of its copies.
    expect(storage.keysUnder(sealedPrefix(target.id))).toEqual([]);

    // Nothing at all is no file.
    storage.put(uploadKeyOf(target.id), 0, new Uint8Array());
    const empty = await expectProblem(
      save(owner, patient, [{ id: target.id, category: 'other' }]),
      422,
      'file.type_unsupported',
    );
    expect(empty.detail).toBe('This file is empty');

    // A type of another category, and someone else's upload.
    storage.put(uploadKeyOf(target.id), 1000, sampleStart('referral.pdf'));
    expect(
      (await save(owner, patient, [{ id: target.id, category: 'other', subCategory: 'panoramic' }]))
        .status,
    ).toBe(400);
    await expectProblem(
      save(dentist.agent, patient, [{ id: target.id, category: 'other' }]),
      404,
      'file.not_found',
    );

    const document = await ok<PatientFiles>(
      save(owner, patient, [{ id: target.id, category: 'other' }]),
      201,
    );
    // A document has no thumbnail and opens inline from its original; no camera, so taken = now.
    expect(document.items[0]).toMatchObject({
      kind: 'document',
      mimeType: 'application/pdf',
      thumbnailUrl: null,
      takenAt: new Date(NOON).toISOString(),
    });
    expect(document.items[0]?.viewUrl).toContain('response-content-disposition=inline');
  });

  it("links a file to one of the patient's visits and takes its date", async () => {
    const patient = await createPatient('Visit Link');
    const stranger = await createPatient('Other Patient');
    const visit = await startVisit(patient);
    const foreign = await startVisit(stranger);

    const target = await upload(dentist.agent, patient, { filename: 'bitewing.png' });
    await expectProblem(
      save(dentist.agent, patient, [{ id: target.id, category: 'xray', visitId: foreign.id }]),
      422,
      'file.visit_mismatch',
    );
    testApp.clock.advance({ minutes: 5 });
    const saved = await ok<PatientFiles>(
      save(dentist.agent, patient, [{ id: target.id, category: 'xray', visitId: visit.id }]),
      201,
    );
    testApp.clock.set(new Date(NOON));
    expect(saved.items[0]).toMatchObject({
      visitId: visit.id,
      visit: { id: visit.id, displayNumber: visit.displayNumber, status: 'in_progress' },
      takenAt: visit.startedAt,
    });
    const [entry] = await auditOf(target.id);
    expect(entry?.visitId).toBe(visit.id);

    await expectProblem(
      dentist.agent
        .patch('/api/v1/files')
        .send({ ids: [target.id], patch: { visitId: foreign.id } }),
      422,
      'file.visit_mismatch',
    );
  });

  it('edits metadata, the note and the orientation, audited before → after', async () => {
    const patient = await createPatient('Edit Me');
    const file = await savedFile(dentist.agent, patient, { subCategory: 'panoramic' });
    const patch = (ids: string[], body: Record<string, unknown>) =>
      assistant.agent.patch('/api/v1/files').send({ ids, patch: body });

    const edited = await ok<PatientFiles>(
      patch([file.id], { note: 'after whitening', orientation: 180 }),
    );
    expect(edited.items[0]).toMatchObject({ note: 'after whitening', orientation: 180 });
    const [update] = await auditOf(file.id);
    expect(update).toMatchObject({ action: 'file.update', actorUserId: assistant.user.id });
    expect(update?.before).toMatchObject({ note: '', orientation: 0 });
    expect(update?.after).toMatchObject({ note: 'after whitening', orientation: 180 });

    // Nothing changed: nothing written, nothing audited.
    await ok<PatientFiles>(patch([file.id], { note: 'after whitening' }));
    expect(await auditOf(file.id)).toHaveLength(2);

    // A photo is no panoramic: the type goes with the category.
    const recategorised = await ok<PatientFiles>(patch([file.id], { category: 'photo' }));
    expect(recategorised.items[0]).toMatchObject({ category: 'photo', subCategory: null });

    const invalid = await patch([file.id], { takenAt: '2026-06-12T09:00:00.000Z' });
    expect(invalid.status).toBe(422);
    expect(problem(invalid.body).errors?.[0]?.path).toBe('patch.takenAt');
    const dated = await ok<PatientFiles>(patch([file.id], { takenAt: '2026-05-01T10:00:00.000Z' }));
    expect(dated.items[0]?.takenAt).toBe('2026-05-01T10:00:00.000Z');

    // The bulk bar: one patch, several files.
    const second = await savedFile(dentist.agent, patient);
    const bulk = await ok<PatientFiles>(patch([file.id, second.id], { toothCode: '11' }));
    expect(bulk.items.map((item) => item.toothCode)).toEqual(['11', '11']);
    await expectProblem(patch([file.id, newId()], { toothCode: '12' }), 404, 'file.not_found');
    expect((await listOf(owner, patient)).map((item) => item.toothCode)).toEqual(['11', '11']);
  });

  it('lets a dentist archive any file, and an uploader their own for 24 hours (F13)', async () => {
    const patient = await createPatient('Archive Rules');
    const byDentist = await savedFile(dentist.agent, patient);
    const byAssistant = await savedFile(assistant.agent, patient);
    const archive = (agent: TestAgent, ids: string[], reason?: string) =>
      agent.post('/api/v1/files/archive').send({ ids, reason });
    const restore = (agent: TestAgent, ids: string[]) =>
      agent.post('/api/v1/files/restore').send({ ids });

    await expectProblem(archive(assistant.agent, [byDentist.id]), 403, 'file.archive_forbidden');

    const own = await ok<PatientFiles>(archive(assistant.agent, [byAssistant.id], 'duplicate'));
    expect(own.items[0]).toMatchObject({
      archivedBy: assistant.user.id,
      archivedByName: assistant.user.displayName,
      archiveReason: 'duplicate',
    });
    expect(own.items[0]?.archivedAt).not.toBeNull();
    const [archived] = await auditOf(byAssistant.id);
    expect(archived).toMatchObject({ action: 'file.archive', reason: 'duplicate' });

    // Archived files stay in the read (the SPA hides them); the Undo is the archiver's.
    expect((await listOf(owner, patient)).map((file) => file.id)).toContain(byAssistant.id);
    const undone = await ok<PatientFiles>(restore(assistant.agent, [byAssistant.id]));
    expect(undone.items[0]).toMatchObject({ archivedAt: null, archiveReason: null });

    // A day later the upload is no longer the assistant's to archive.
    await database.ownerPool.query(
      `update files set saved_at = saved_at - interval '25 hours' where id = $1`,
      [byAssistant.id],
    );
    await expectProblem(archive(assistant.agent, [byAssistant.id]), 403, 'file.archive_forbidden');

    await ok<PatientFiles>(archive(dentist.agent, [byDentist.id, byAssistant.id]));
    // Not the assistant's archive to undo.
    await expectProblem(restore(assistant.agent, [byAssistant.id]), 403, 'file.archive_forbidden');
    const restored = await ok<PatientFiles>(restore(owner, [byDentist.id, byAssistant.id]));
    expect(restored.items.every((file) => file.archivedAt === null)).toBe(true);
    expect((await auditOf(byDentist.id)).map((entry) => entry.action)).toEqual([
      'file.restore',
      'file.archive',
      'file.upload',
    ]);
  });

  it("discards pending uploads and their objects, and only the caller's", async () => {
    const patient = await createPatient('Discard');
    const mine = await upload(assistant.agent, patient, { filename: 'a.jpg', preview: true });
    const theirs = await upload(dentist.agent, patient, { filename: 'b.jpg' });

    const response = await assistant.agent.delete(
      `/api/v1/files/uploads?ids=${mine.id},${theirs.id}`,
    );
    expect(response.status).toBe(204);
    expect(storage.has(uploadKeyOf(mine.id))).toBe(false);
    expect(storage.has(uploadKeyOf(mine.id, 'thumb.jpg'))).toBe(false);
    expect(storage.has(uploadKeyOf(theirs.id))).toBe(true);
    await expectProblem(
      save(assistant.agent, patient, [{ id: mine.id, category: 'photo' }]),
      404,
      'file.not_found',
    );
    await ok<PatientFiles>(
      save(dentist.agent, patient, [{ id: theirs.id, category: 'photo' }]),
      201,
    );
  });

  it('keeps a saved original out of reach of its upload URL', async () => {
    const patient = await createPatient('Sealed');
    const target = await upload(dentist.agent, patient, { filename: 'pano.jpg', sizeBytes: 3000 });
    const saved = await ok<PatientFiles>(
      save(dentist.agent, patient, [{ id: target.id, category: 'xray' }]),
      201,
    );
    // The upload URL is still valid for minutes: the browser writes other, larger bytes with it.
    storage.put(uploadKeyOf(target.id), MAX_FILE_BYTES * 4, sampleStart('page.txt'));

    const [listed] = await listOf(owner, patient);
    expect(listed).toMatchObject({ id: saved.items[0]?.id, sizeBytes: 3000 });
    const storageKey = listed?.storageKey ?? '';
    expect(storageKey).toMatch(sealedKey(target.id));
    expect(storage.startOf(storageKey)).toEqual(sampleStart('pano.jpg'));
    const download = await ok<FileDownload>(owner.get(`/api/v1/files/${target.id}/download`));
    expect(download.url).toContain(`/${storageKey}?`);
  });

  it("leaves a saved file's objects alone when a second Save of the same upload loses", async () => {
    const patient = await createPatient('Twice');
    const target = await upload(dentist.agent, patient, { filename: 'pano.jpg' });
    const item = [{ id: target.id, category: 'xray' }];

    // The first Save has copied its original when a second Save of the same upload (a double
    // click) runs from start to finish and commits.
    let overtaking: Promise<{ status: number; body: unknown }> | undefined;
    storage.afterNextCopy = async () => {
      overtaking = save(dentist.agent, patient, item);
      await overtaking;
    };
    const first = await save(dentist.agent, patient, item);
    const second = await overtaking;

    expect(second?.status, JSON.stringify(second?.body)).toBe(201);
    // The first finds its upload already saved; it removes its own copies and nothing else.
    expect(first.status, JSON.stringify(first.body)).toBe(404);
    expect(problem(first.body).code).toBe('file.not_found');

    const [listed] = await listOf(owner, patient);
    const storageKey = listed?.storageKey ?? '';
    expect(storageKey).toMatch(sealedKey(target.id));
    expect(storage.keysUnder(sealedPrefix(target.id))).toEqual([storageKey]);
  });

  it('answers a short-lived download of the original under its own name', async () => {
    const patient = await createPatient('Download');
    const file = await savedFile(dentist.agent, patient);
    const download = await ok<FileDownload>(
      assistant.agent.get(`/api/v1/files/${file.id}/download`),
    );
    const [listed] = await listOf(owner, patient);
    expect(download.url).toContain(`/${listed?.storageKey ?? 'no key'}?`);
    expect(download.url).toContain('X-Amz-Expires=60');
    expect(download.url).toContain('response-content-disposition=attachment');
    expect(decodeURIComponent(download.url)).toContain('filename="pano.jpg"');
    await expectProblem(
      assistant.agent.get(`/api/v1/files/${newId()}/download`),
      404,
      'file.not_found',
    );
  });

  it('moves every file to the kept patient in the merge transaction (F12)', async () => {
    const kept = await createPatient('Merge Kept');
    const dropped = await createPatient('Merge Dropped');
    const live = await savedFile(dentist.agent, dropped);
    const archived = await savedFile(dentist.agent, dropped);
    await ok(dentist.agent.post('/api/v1/files/archive').send({ ids: [archived.id] }));
    const pending = await upload(dentist.agent, dropped, { filename: 'late.png' });

    const merge = await owner
      .post('/api/v1/patients/merge')
      .send({ keepId: kept.id, dropId: dropped.id, reason: 'Same person' });
    expect(merge.status, JSON.stringify(merge.body)).toBe(200);

    expect(await listOf(owner, dropped)).toEqual([]);
    const files = await listOf(owner, kept);
    expect(files.map((file) => file.id).sort()).toEqual([live.id, archived.id].sort());
    expect(files.every((file) => file.patientId === kept.id)).toBe(true);
    // The upload in flight follows too: it is saved on the kept record.
    await ok<PatientFiles>(save(dentist.agent, kept, [{ id: pending.id, category: 'xray' }]), 201);
    const repoint = (
      (await owner.get(`/api/v1/audit?resourceType=patient&resourceId=${kept.id}&limit=100`))
        .body as AuditPage
    ).items.find((entry) => entry.action === 'file.repoint');
    expect(repoint?.after).toMatchObject({ droppedId: dropped.id, count: 3 });
  });
});
