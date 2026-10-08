import { MAX_BATCH_FILES, MAX_FILE_BYTES } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import {
  type Batch,
  type BatchAction,
  batchReducer,
  batchStatus,
  EMPTY_META,
  hasWork,
  isEdited,
  metaOf,
  saveItems,
} from './upload-batch';

const file = (name: string, type = '', size = 1000) => {
  const blob = new File(['x'], name, { type });
  Object.defineProperty(blob, 'size', { value: size });
  return blob;
};

const run = (batch: Batch, ...actions: BatchAction[]) => actions.reduce(batchReducer, batch);

const empty: Batch = { header: EMPTY_META, tiles: [] };

const add = (...names: string[]): BatchAction => ({
  type: 'add',
  files: names.map((name) => ({ key: name, file: file(name) })),
});

const uploaded = (key: string): BatchAction[] => [
  { type: 'started', key, uploadId: `id-${key}` },
  { type: 'uploaded', key },
];

const tile = (batch: Batch, key: string) => {
  const found = batch.tiles.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`no tile ${key}`);
  return found;
};

describe('adding files (F1)', () => {
  it('starts accepted files uploading and refuses the rest on their tile', () => {
    const batch = run(empty, {
      type: 'add',
      files: [
        { key: 'a', file: file('pano.jpg', 'image/jpeg') },
        { key: 'b', file: file('scan.dcm') },
        { key: 'c', file: file('clip.mp4', 'video/mp4') },
        { key: 'd', file: file('huge.png', 'image/png', MAX_FILE_BYTES + 1) },
        { key: 'e', file: file('referral.pdf', 'application/pdf') },
      ],
    });
    expect(batch.tiles.map(({ status, refusal, kind }) => [status, refusal, kind])).toEqual([
      ['uploading', null, 'image'],
      ['refused', 'dicom', null],
      ['refused', 'unsupported', null],
      ['refused', 'too_large', 'image'],
      ['uploading', null, 'document'],
    ]);
  });

  it('takes at most 20 files, refused ones not counting', () => {
    const names = Array.from({ length: MAX_BATCH_FILES }, (_, index) => `p${index}.jpg`);
    const batch = run(empty, add('x.dcm', ...names, 'one-more.jpg'));
    expect(batch.tiles.filter((entry) => entry.status === 'uploading')).toHaveLength(
      MAX_BATCH_FILES,
    );
    expect(tile(batch, 'one-more.jpg').refusal).toBe('too_many');
  });
});

describe('apply to all (F4)', () => {
  const two = run(empty, add('a.jpg', 'b.jpg'), ...uploaded('a.jpg'), ...uploaded('b.jpg'));

  it('gives every tile what the header says', () => {
    const batch = run(
      two,
      { type: 'header', patch: { category: 'xray' } },
      {
        type: 'header',
        patch: { subCategory: 'panoramic', toothCode: '36', note: 'pre-op' },
      },
    );
    for (const entry of batch.tiles) {
      expect(metaOf(batch, entry)).toMatchObject({
        category: 'xray',
        subCategory: 'panoramic',
        toothCode: '36',
        note: 'pre-op',
      });
      expect(isEdited(batch, entry)).toBe(false);
    }
  });

  it('lets one tile differ, and marks it edited', () => {
    const batch = run(
      two,
      { type: 'header', patch: { category: 'other' } },
      { type: 'tile', key: 'b.jpg', patch: { category: 'photo' } },
      { type: 'tile', key: 'b.jpg', patch: { subCategory: 'extraoral' } },
    );
    expect(metaOf(batch, tile(batch, 'a.jpg')).category).toBe('other');
    expect(metaOf(batch, tile(batch, 'b.jpg'))).toMatchObject({
      category: 'photo',
      subCategory: 'extraoral',
    });
    expect(isEdited(batch, tile(batch, 'a.jpg'))).toBe(false);
    expect(isEdited(batch, tile(batch, 'b.jpg'))).toBe(true);
  });

  it('is not edited once set back to what the header says', () => {
    const batch = run(
      two,
      { type: 'header', patch: { category: 'xray' } },
      { type: 'tile', key: 'a.jpg', patch: { toothCode: '11' } },
      { type: 'tile', key: 'a.jpg', patch: { toothCode: null } },
    );
    expect(isEdited(batch, tile(batch, 'a.jpg'))).toBe(false);
  });

  it('overrides the tiles again when the header sets the same field', () => {
    const batch = run(
      two,
      { type: 'header', patch: { category: 'xray', toothCode: '36' } },
      { type: 'tile', key: 'a.jpg', patch: { category: 'photo', toothCode: '11' } },
      { type: 'header', patch: { category: 'xray' } },
    );
    // The category is the header's again; the tooth, which the header did not touch, is kept.
    expect(metaOf(batch, tile(batch, 'a.jpg'))).toMatchObject({
      category: 'xray',
      toothCode: '11',
    });
  });

  it('drops a type that does not belong to the new category', () => {
    const batch = run(
      two,
      { type: 'header', patch: { category: 'xray' } },
      { type: 'header', patch: { subCategory: 'panoramic' } },
      { type: 'header', patch: { category: 'photo' } },
    );
    expect(batch.header.subCategory).toBeNull();
    const other = run(batch, { type: 'header', patch: { category: 'other' } });
    expect(metaOf(other, tile(other, 'a.jpg')).subCategory).toBeNull();
  });
});

describe('Save (F2, F3)', () => {
  it('waits for a category on every uploaded tile and for uploads in flight', () => {
    const uploading = run(empty, add('a.jpg', 'b.jpg'), ...uploaded('a.jpg'));
    expect(batchStatus(uploading)).toMatchObject({
      canSave: false,
      uploading: 1,
      uncategorised: 1,
    });
    const categorised = run(uploading, { type: 'header', patch: { category: 'photo' } });
    expect(batchStatus(categorised).canSave).toBe(false);
    expect(batchStatus(run(categorised, ...uploaded('b.jpg'))).canSave).toBe(true);
  });

  it('counts only the files it will save: not a refused one, not a failed one', () => {
    const batch = run(
      empty,
      add('a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.dcm'),
      { type: 'header', patch: { category: 'photo', subCategory: 'intraoral' } },
      ...uploaded('a.jpg'),
      ...uploaded('b.jpg'),
      ...uploaded('c.jpg'),
      { type: 'failed', key: 'd.jpg' },
    );
    const status = batchStatus(batch);
    expect(status.ready.map((entry) => entry.key)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(status.canSave).toBe(true);
    expect(status.totalBytes).toBe(4000);

    const retried = run(batch, { type: 'retry', key: 'd.jpg' });
    expect(batchStatus(retried).canSave).toBe(false);
    const done = run(retried, ...uploaded('d.jpg'));
    expect(batchStatus(done).ready).toHaveLength(4);
  });

  it('builds the request from each tile, with what the camera said', () => {
    const batch = run(
      empty,
      add('a.jpg', 'b.pdf'),
      { type: 'prepared', key: 'a.jpg', previewUrl: 'blob:1', exifTakenAt: '2026-03-12T10:42:00' },
      ...uploaded('a.jpg'),
      ...uploaded('b.pdf'),
      { type: 'header', patch: { category: 'photo', visitId: 'v1', note: '  pre-op ' } },
      { type: 'tile', key: 'b.pdf', patch: { category: 'other', note: 'referral' } },
    );
    expect(saveItems(batch)).toEqual([
      {
        id: 'id-a.jpg',
        category: 'photo',
        subCategory: null,
        toothCode: null,
        visitId: 'v1',
        note: 'pre-op',
        exifTakenAt: '2026-03-12T10:42:00',
      },
      {
        id: 'id-b.pdf',
        category: 'other',
        subCategory: null,
        toothCode: null,
        visitId: 'v1',
        note: 'referral',
        exifTakenAt: null,
      },
    ]);
  });

  it('knows whether closing throws work away', () => {
    expect(hasWork(empty)).toBe(false);
    expect(hasWork(run(empty, add('x.dcm')))).toBe(false);
    const batch = run(empty, add('a.jpg'));
    expect(hasWork(batch)).toBe(true);
    expect(hasWork(run(batch, { type: 'remove', key: 'a.jpg' }))).toBe(false);
  });
});
