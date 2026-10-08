import type { PatientFile } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import {
  filterFiles,
  groupByTaken,
  isFiltered,
  linkedVisits,
  NO_FILTER,
  recentOtherFiles,
  toothImages,
  visitFiles,
} from './gallery-filter';
import { fileFixture } from '../files.test-utils';

const BEIRUT = 'Asia/Beirut';
const ids = (files: readonly PatientFile[]) => files.map((file) => file.id);

const pano = fileFixture({ id: 'pano', category: 'xray', subCategory: 'panoramic' });
const bitewing = fileFixture({
  id: 'bitewing',
  category: 'xray',
  subCategory: 'intraoral',
  toothCode: '36',
  visitId: 'v1',
  note: 'Pre-op, deep caries',
});
const smile = fileFixture({ id: 'smile', category: 'photo', subCategory: 'before_after' });
const referral = fileFixture({
  id: 'referral',
  kind: 'document',
  category: 'other',
  originalFilename: 'Referral-Dr-Haddad.pdf',
});
const gone = fileFixture({ id: 'gone', category: 'xray', archivedAt: '2026-06-01T10:00:00.000Z' });
const all = [pano, bitewing, smile, referral, gone];

describe('filterFiles', () => {
  it('hides archived files until asked', () => {
    expect(ids(filterFiles(all, NO_FILTER))).toEqual(['pano', 'bitewing', 'smile', 'referral']);
    expect(ids(filterFiles(all, { ...NO_FILTER, showArchived: true }))).toContain('gone');
  });

  it('filters by category, with Documents as a kind', () => {
    expect(ids(filterFiles(all, { ...NO_FILTER, category: 'xray' }))).toEqual(['pano', 'bitewing']);
    expect(ids(filterFiles(all, { ...NO_FILTER, category: 'documents' }))).toEqual(['referral']);
  });

  it('combines category, type, tooth and visit', () => {
    expect(ids(filterFiles(all, { ...NO_FILTER, category: 'xray', toothCode: '36' }))).toEqual([
      'bitewing',
    ]);
    expect(ids(filterFiles(all, { ...NO_FILTER, subCategory: 'panoramic' }))).toEqual(['pano']);
    expect(ids(filterFiles(all, { ...NO_FILTER, visitId: 'v1' }))).toEqual(['bitewing']);
    expect(filterFiles(all, { ...NO_FILTER, category: 'photo', toothCode: '36' })).toEqual([]);
  });

  it('searches the note and the filename, whatever the case', () => {
    expect(ids(filterFiles(all, { ...NO_FILTER, q: ' CARIES ' }))).toEqual(['bitewing']);
    expect(ids(filterFiles(all, { ...NO_FILTER, q: 'haddad' }))).toEqual(['referral']);
  });

  it('knows when there is something to clear', () => {
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered({ ...NO_FILTER, showArchived: true })).toBe(true);
    expect(isFiltered({ ...NO_FILTER, q: 'x' })).toBe(true);
  });
});

describe('groupByTaken', () => {
  const taken = (id: string, takenAt: string) => fileFixture({ id, takenAt });

  it("heads the groups Today, Yesterday, This week, then months, in the clinic's zone", () => {
    const files = [
      // 22:30 UTC on the 9th is already the 10th in Beirut.
      taken('late', '2026-06-09T22:30:00.000Z'),
      taken('morning', '2026-06-09T21:30:00.000Z'),
      taken('y', '2026-06-09T08:00:00.000Z'),
      taken('w1', '2026-06-08T08:00:00.000Z'),
      taken('w2', '2026-06-04T08:00:00.000Z'),
      taken('june', '2026-06-03T08:00:00.000Z'),
      taken('may', '2026-05-20T08:00:00.000Z'),
      taken('old', '2024-12-31T08:00:00.000Z'),
    ];
    expect(
      groupByTaken(files, '2026-06-10', BEIRUT).map((group) => [group.key, ids(group.files)]),
    ).toEqual([
      ['today', ['late', 'morning']],
      ['yesterday', ['y']],
      ['week', ['w1', 'w2']],
      ['2026-06', ['june']],
      ['2026-05', ['may']],
      ['2024-12', ['old']],
    ]);
  });

  it('gives a month group its year and month', () => {
    const [group] = groupByTaken([taken('old', '2024-12-31T08:00:00.000Z')], '2026-06-10', BEIRUT);
    expect(group?.group).toEqual({ kind: 'month', year: 2024, month: 12 });
  });
});

describe('what each surface takes', () => {
  const now = new Date('2026-06-10T09:00:00Z');
  const files = [
    fileFixture({ id: 'this-1', visitId: 'v1', uploadedAt: '2026-06-10T08:00:00.000Z' }),
    fileFixture({ id: 'this-2', visitId: 'v1', uploadedAt: '2026-06-10T08:30:00.000Z' }),
    fileFixture({ id: 'recent', takenAt: '2026-05-01T08:00:00.000Z', toothCode: '36' }),
    fileFixture({
      id: 'doc-36',
      kind: 'document',
      takenAt: '2026-04-01T08:00:00.000Z',
      toothCode: '36',
    }),
    fileFixture({ id: 'old', takenAt: '2026-01-01T08:00:00.000Z' }),
    fileFixture({
      id: 'archived',
      visitId: 'v1',
      toothCode: '36',
      archivedAt: '2026-06-10T08:40:00.000Z',
    }),
  ];

  it('the visit strip: this visit newest first, then the last 90 days', () => {
    expect(ids(visitFiles(files, 'v1'))).toEqual(['this-2', 'this-1']);
    expect(ids(recentOtherFiles(files, 'v1', now))).toEqual(['recent', 'doc-36']);
  });

  it("the tooth panel: the tooth's images, not its documents or archived files", () => {
    expect(ids(toothImages(files, '36'))).toEqual(['recent']);
    expect(toothImages(files, '11')).toEqual([]);
  });

  it('the Visit filter: each linked visit once, newest first', () => {
    const visit = (id: string, displayNumber: number) => ({
      id,
      displayNumber,
      localDate: '2026-06-10',
      status: 'completed' as const,
    });
    const linked = [
      fileFixture({ id: 'a', visitId: 'v1', visit: visit('v1', 70) }),
      fileFixture({ id: 'b', visitId: 'v2', visit: visit('v2', 71) }),
      fileFixture({ id: 'c', visitId: 'v1', visit: visit('v1', 70) }),
      fileFixture({ id: 'd' }),
    ];
    expect(linkedVisits(linked).map((entry) => entry.displayNumber)).toEqual([71, 70]);
  });
});
