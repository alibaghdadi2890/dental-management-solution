import type { PatientFile } from '@dcm/contracts';

/** A saved image of a patient; a test overrides what it is about. */
export function fileFixture(overrides: Partial<PatientFile> = {}): PatientFile {
  return {
    id: '018f2b1e-0000-7000-8000-0000000000f1',
    patientId: '018f2b1e-0000-7000-8000-0000000000a1',
    kind: 'image',
    category: 'xray',
    subCategory: null,
    toothCode: null,
    visit: null,
    visitId: null,
    takenAt: '2026-06-10T08:00:00.000Z',
    note: '',
    originalFilename: 'pano.jpg',
    sizeBytes: 482_113,
    mimeType: 'image/jpeg',
    orientation: 0,
    uploadedBy: '018f2b1e-0000-7000-8000-0000000000b1',
    uploadedByName: 'Dr. Lina Haddad',
    uploadedAt: '2026-06-10T08:05:00.000Z',
    archivedAt: null,
    archivedBy: null,
    archivedByName: null,
    archiveReason: null,
    thumbnailUrl: 'https://files.test/thumb.jpg',
    viewUrl: 'https://files.test/display.jpg',
    storageKey: null,
    ...overrides,
  };
}
