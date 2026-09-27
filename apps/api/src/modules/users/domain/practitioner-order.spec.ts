import { describe, expect, it } from 'vitest';
import { sortByDisplayName } from './practitioner-order';

const item = (authUserId: string, displayName: string) => ({ authUserId, displayName });

describe('sortByDisplayName', () => {
  it('collates case and diacritics for the given locale', () => {
    const amir = item('a', 'dr. amir');
    const emile = item('b', 'Dr. Émile');
    const zed = item('c', 'Dr. Zed');
    expect(sortByDisplayName([zed, amir, emile], 'en')).toEqual([amir, emile, zed]);
  });

  it('breaks a tie between identical display names by user id', () => {
    const second = item('b-user', 'Dr. Ana Reyes');
    const first = item('a-user', 'Dr. Ana Reyes');
    expect(sortByDisplayName([second, first], 'en')).toEqual([first, second]);
  });

  it('does not mutate the input array', () => {
    const items = [item('b', 'Zed'), item('a', 'Amir')];
    const copy = [...items];
    sortByDisplayName(items, 'en');
    expect(items).toEqual(copy);
  });
});
