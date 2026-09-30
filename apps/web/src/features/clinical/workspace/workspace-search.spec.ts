import { describe, expect, it } from 'vitest';
import { parseWorkspaceSearch } from './workspace-search';

describe('parseWorkspaceSearch', () => {
  it('reads a tooth code, as text or as the number the router makes of a bare one', () => {
    expect(parseWorkspaceSearch({ tooth: '16' })).toEqual({ tooth: '16' });
    expect(parseWorkspaceSearch({ tooth: 54 })).toEqual({ tooth: '54' });
  });

  it('drops anything that is not a tooth code', () => {
    for (const tooth of [99, '99', 'abc', '', ['16'], { code: '16' }, null, true]) {
      expect(parseWorkspaceSearch({ tooth })).toEqual({});
    }
  });

  it('never throws on a malformed search', () => {
    expect(parseWorkspaceSearch(undefined)).toEqual({});
    expect(parseWorkspaceSearch(null)).toEqual({});
    expect(parseWorkspaceSearch('tooth=16')).toEqual({});
    expect(parseWorkspaceSearch({})).toEqual({});
  });
});
