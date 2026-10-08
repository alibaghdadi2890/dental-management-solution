import { describe, expect, it } from 'vitest';
import { changesOf, type FileMetadata } from './file-changes';

const file: FileMetadata = {
  category: 'xray',
  subCategory: 'panoramic',
  toothCode: '36',
  visitId: null,
  takenAt: new Date('2026-03-12T08:42:00Z'),
  note: 'pre-op',
  orientation: 0,
};

describe('changesOf', () => {
  it('keeps only what differs', () => {
    expect(
      changesOf(file, {
        category: 'xray',
        toothCode: '36',
        note: 'pre-op',
        takenAt: '2026-03-12T08:42:00.000Z',
        orientation: 0,
      }),
    ).toEqual({});
    expect(changesOf(file, { note: 'post-op', orientation: 90 })).toEqual({
      note: 'post-op',
      orientation: 90,
    });
  });

  it('clears the tooth and the visit with null', () => {
    expect(changesOf(file, { toothCode: null, visitId: null })).toEqual({ toothCode: null });
  });

  it('drops a type that does not belong to the new category', () => {
    expect(changesOf(file, { category: 'photo' })).toEqual({
      category: 'photo',
      subCategory: null,
    });
    expect(changesOf(file, { category: 'photo', subCategory: 'extraoral' })).toEqual({
      category: 'photo',
      subCategory: 'extraoral',
    });
    // "Other" is a type of both X-rays and photos: it survives the change.
    expect(changesOf({ ...file, subCategory: 'other' }, { category: 'photo' })).toEqual({
      category: 'photo',
    });
  });

  it('ignores a type sent for the wrong category', () => {
    expect(changesOf(file, { subCategory: 'extraoral' })).toEqual({ subCategory: null });
  });
});
