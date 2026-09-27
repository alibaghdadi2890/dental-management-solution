import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  clearFilters,
  LIST_QUERY_DEFAULTS,
  panelParam,
  parsePanel,
  patientsSearchSchema,
  toSearch,
  withFilter,
} from './list-query';

describe('patientsSearchSchema', () => {
  it('fills the list query defaults from an empty URL search', () => {
    expect(patientsSearchSchema.parse({})).toMatchObject({
      view: 'active',
      sort: 'name',
      dir: 'asc',
      page: 1,
      size: 25,
    });
  });

  it('drops a param the schema does not know about', () => {
    const parsed = patientsSearchSchema.parse({ q: 'jane', bogus: 'x' });
    expect(parsed).not.toHaveProperty('bogus');
    expect(parsed.q).toBe('jane');
  });

  it('treats a cleared (blank) filter like an absent one', () => {
    expect(patientsSearchSchema.parse({ dentist: '' }).dentist).toBeUndefined();
  });

  it('carries the panel and create-prefill fields through', () => {
    const parsed = patientsSearchSchema.parse({
      panel: 'new',
      fullName: 'Jane',
      phone: '03123456',
    });
    expect(parsed.panel).toBe('new');
    expect(parsed.fullName).toBe('Jane');
    expect(parsed.phone).toBe('03123456');
  });
});

describe('activeFilterCount', () => {
  it('is 0 for the bare default query', () => {
    expect(activeFilterCount(LIST_QUERY_DEFAULTS)).toBe(0);
  });

  it('counts the search box and each filter chip, but not view/sort/dir/page/size', () => {
    expect(activeFilterCount({ ...LIST_QUERY_DEFAULTS, q: 'jane' })).toBe(1);
    expect(activeFilterCount({ ...LIST_QUERY_DEFAULTS, dentist: 'none', age: 'child' })).toBe(2);
    expect(
      activeFilterCount({
        ...LIST_QUERY_DEFAULTS,
        view: 'owing',
        sort: 'balance',
        dir: 'desc',
        page: 3,
        size: 50,
      }),
    ).toBe(0);
  });
});

describe('withFilter', () => {
  it('resets the page to 1 when a filter, the search box, the view or the sort changes', () => {
    const onPageThree = { ...LIST_QUERY_DEFAULTS, page: 3 };
    expect(withFilter(onPageThree, { q: 'jane' }).page).toBe(1);
    expect(withFilter(onPageThree, { dentist: 'none' }).page).toBe(1);
    expect(withFilter(onPageThree, { view: 'archived' }).page).toBe(1);
    expect(withFilter(onPageThree, { sort: 'age' }).page).toBe(1);
  });

  it('does not reset the page for a direction flip or an explicit page/size change', () => {
    const onPageThree = { ...LIST_QUERY_DEFAULTS, page: 3 };
    expect(withFilter(onPageThree, { dir: 'desc' }).page).toBe(3);
    expect(withFilter(onPageThree, { size: 50 }).page).toBe(3);
    expect(withFilter(onPageThree, { page: 5 }).page).toBe(5);
  });
});

describe('clearFilters', () => {
  it('keeps the saved view and the page size, resets everything else', () => {
    const query = {
      ...LIST_QUERY_DEFAULTS,
      view: 'owing' as const,
      size: 50 as const,
      q: 'jane',
      dentist: 'none' as const,
      sort: 'age' as const,
      dir: 'desc' as const,
      page: 4,
    };
    expect(clearFilters(query)).toEqual({ ...LIST_QUERY_DEFAULTS, view: 'owing', size: 50 });
  });
});

describe('panel round-trip', () => {
  it.each([
    [{ kind: 'new' } as const, 'new'],
    [{ kind: 'edit', id: 'p-1' } as const, 'edit:p-1'],
    [{ kind: 'quick', id: 'p-1' } as const, 'quick:p-1'],
    [{ kind: 'merge', ids: ['p-1', 'p-2'] } as const, 'merge:p-1,p-2'],
  ])('round-trips %o', (panel, token) => {
    expect(panelParam(panel)).toBe(token);
    expect(parsePanel(token)).toEqual(panel);
  });

  it('has no panel for an absent or empty param', () => {
    expect(parsePanel(undefined)).toBeNull();
    expect(parsePanel(null)).toBeNull();
    expect(parsePanel('')).toBeNull();
    expect(panelParam(null)).toBeUndefined();
  });

  it.each(['bogus', 'edit:', 'quick:', 'merge:only-one', 'merge:p-1,p-1'])(
    'treats %s as no panel',
    (token) => {
      expect(parsePanel(token)).toBeNull();
    },
  );
});

describe('toSearch', () => {
  it('omits every field still at its default', () => {
    expect(toSearch(LIST_QUERY_DEFAULTS)).toEqual({});
  });

  it('keeps only the fields that differ from the default', () => {
    expect(toSearch({ ...LIST_QUERY_DEFAULTS, view: 'owing', page: 2 })).toEqual({
      view: 'owing',
      page: 2,
    });
  });
});
