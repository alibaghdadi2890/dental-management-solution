import { describe, expect, it } from 'vitest';
import {
  canArchiveFile,
  canRestoreFile,
  classifyUpload,
  type FileActor,
  filePatchSchema,
  isSubCategoryOf,
  needsDecoder,
  saveFilesSchema,
} from './files.js';
import type { Permission } from './permissions.js';

const ID = '018f2b1e-0000-7000-8000-000000000001';
const OTHER = '018f2b1e-0000-7000-8000-000000000002';

describe('classifyUpload (F1)', () => {
  it.each([
    ['pano.JPG', 'image/jpeg', 'image', 'image/jpeg'],
    ['scan.png', '', 'image', 'image/png'],
    ['IMG_0012.HEIC', '', 'image', 'image/heic'],
    ['ceph.tif', 'application/octet-stream', 'image', 'image/tiff'],
    ['referral.pdf', 'application/pdf', 'document', 'application/pdf'],
    ['notes.txt', 'text/plain', 'document', 'text/plain'],
    ['image', 'image/png', 'image', 'image/png'],
  ])('accepts %s (%s) as %s', (filename, mime, kind, stored) => {
    expect(classifyUpload(filename, mime)).toEqual({ accepted: true, kind, mimeType: stored });
  });

  it('refuses DICOM with its own reason', () => {
    expect(classifyUpload('series-1.dcm', '')).toEqual({ accepted: false, reason: 'dicom' });
    expect(classifyUpload('series', 'application/dicom')).toEqual({
      accepted: false,
      reason: 'dicom',
    });
  });

  it('refuses anything else', () => {
    expect(classifyUpload('setup.exe', 'application/x-msdownload')).toEqual({
      accepted: false,
      reason: 'unsupported',
    });
    expect(classifyUpload('movie.mp4', 'video/mp4')).toEqual({
      accepted: false,
      reason: 'unsupported',
    });
  });

  it('knows which images need a decoder before they can be drawn', () => {
    expect(needsDecoder('image/heic')).toBe('heic');
    expect(needsDecoder('image/tiff')).toBe('tiff');
    expect(needsDecoder('image/jpeg')).toBeNull();
  });
});

describe('categories', () => {
  it('ties a type to its category', () => {
    expect(isSubCategoryOf('xray', 'panoramic')).toBe(true);
    expect(isSubCategoryOf('photo', 'panoramic')).toBe(false);
    expect(isSubCategoryOf('other', 'other')).toBe(false);
  });

  it('refuses a saved file whose type belongs to another category', () => {
    const save = (subCategory: string) =>
      saveFilesSchema.safeParse({
        patientId: ID,
        files: [{ id: OTHER, category: 'photo', subCategory }],
      }).success;
    expect(save('before_after')).toBe(true);
    expect(save('cephalometric')).toBe(false);
  });

  it('refuses an empty patch', () => {
    expect(filePatchSchema.safeParse({}).success).toBe(false);
    expect(filePatchSchema.safeParse({ toothCode: null }).success).toBe(true);
  });
});

describe('who may archive a file (F13)', () => {
  const actor = (userId: string, ...permissions: Permission[]): FileActor => ({
    userId,
    can: (permission) => permissions.includes(permission),
  });
  const uploadedAt = '2026-03-12T10:00:00.000Z';
  const file = { uploadedBy: 'assistant', uploadedAt };
  const hoursLater = (hours: number) => new Date(Date.parse(uploadedAt) + hours * 3_600_000);

  it('lets file:archive archive any file, whenever', () => {
    const dentist = actor('dentist', 'file:write', 'file:archive');
    expect(canArchiveFile(dentist, file, hoursLater(500))).toBe(true);
  });

  it('lets the uploader archive their own upload for 24 hours', () => {
    const assistant = actor('assistant', 'file:read', 'file:write');
    expect(canArchiveFile(assistant, file, hoursLater(1))).toBe(true);
    expect(canArchiveFile(assistant, file, hoursLater(24))).toBe(true);
    expect(canArchiveFile(assistant, file, hoursLater(24.01))).toBe(false);
  });

  it("does not let them archive someone else's file", () => {
    const frontdesk = actor('frontdesk', 'file:read', 'file:write');
    expect(canArchiveFile(frontdesk, file, hoursLater(1))).toBe(false);
  });

  it('needs file:write for the uploader rule', () => {
    expect(canArchiveFile(actor('assistant', 'file:read'), file, hoursLater(1))).toBe(false);
  });

  it('lets file:archive, or whoever archived it, restore', () => {
    const assistant = actor('assistant', 'file:write');
    expect(canRestoreFile(assistant, { archivedBy: 'assistant' })).toBe(true);
    expect(canRestoreFile(assistant, { archivedBy: 'dentist' })).toBe(false);
    expect(canRestoreFile(actor('owner', 'file:archive'), { archivedBy: 'dentist' })).toBe(true);
  });
});
