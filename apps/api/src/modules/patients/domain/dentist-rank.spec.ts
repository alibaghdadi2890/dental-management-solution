import { describe, expect, it } from 'vitest';
import { dentistRank } from './dentist-rank';

/** `id` is the staff profile id (ADR-0020). */
const dentist = (id: string, displayName: string) => ({ id, displayName });

describe('dentistRank', () => {
  const inNameOrder = [
    dentist('a', 'Dr. Amal'),
    dentist('b', 'Dr. Émile'),
    dentist('c', 'Dr. Zed'),
  ];

  it('asc: one key per dentist in the given order, the rest last', () => {
    expect(dentistRank(inNameOrder, 'asc', 'en')).toEqual({
      ids: ['a', 'b', 'c'],
      keys: [1, 2, 3],
      restKey: 4,
    });
  });

  it('desc: reversed keys, the rest still last', () => {
    expect(dentistRank(inNameOrder, 'desc', 'en')).toEqual({
      ids: ['a', 'b', 'c'],
      keys: [3, 2, 1],
      restKey: 4,
    });
  });

  it('gives dentists with collation-equal names the same key (dense rank)', () => {
    const twins = [
      dentist('a', 'Dr. Amal'),
      dentist('b', 'Dr. Emile'),
      dentist('c', 'dr. émile'),
      dentist('d', 'Dr. Zed'),
    ];
    expect(dentistRank(twins, 'asc', 'en')).toEqual({
      ids: ['a', 'b', 'c', 'd'],
      keys: [1, 2, 2, 3],
      restKey: 4,
    });
    expect(dentistRank(twins, 'desc', 'en').keys).toEqual([3, 2, 2, 1]);
  });

  it('ranks nobody when no dentist is assigned', () => {
    expect(dentistRank([], 'asc', 'en')).toEqual({ ids: [], keys: [], restKey: 1 });
    expect(dentistRank([], 'desc', 'en')).toEqual({ ids: [], keys: [], restKey: 1 });
  });
});
