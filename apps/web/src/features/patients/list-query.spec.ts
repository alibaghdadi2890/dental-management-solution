import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  clearFilters,
  LIST_QUERY_DEFAULTS,
  listQueryOf,
  panelParam,
  parsePanel,
  parsePatientsSearch,
  sortPatch,
  withoutBalanceViews,
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

  it('does not count lastVisit "any" ("no filter") as active', () => {
    expect(activeFilterCount({ ...LIST_QUERY_DEFAULTS, lastVisit: 'any' })).toBe(0);
    expect(activeFilterCount({ ...LIST_QUERY_DEFAULTS, lastVisit: 'never' })).toBe(1);
  });
});

describe('withFilter', () => {
  it('resets the page to 1 when a filter, the search box, the view, the sort or the size changes', () => {
    const onPageThree = { ...LIST_QUERY_DEFAULTS, page: 3 };
    expect(withFilter(onPageThree, { q: 'jane' }).page).toBe(1);
    expect(withFilter(onPageThree, { dentist: 'none' }).page).toBe(1);
    expect(withFilter(onPageThree, { view: 'archived' }).page).toBe(1);
    expect(withFilter(onPageThree, { sort: 'age' }).page).toBe(1);
    expect(withFilter(onPageThree, { size: 50 }).page).toBe(1);
  });

  it('does not reset the page for a direction flip or an explicit page change', () => {
    const onPageThree = { ...LIST_QUERY_DEFAULTS, page: 3 };
    expect(withFilter(onPageThree, { dir: 'desc' }).page).toBe(3);
    expect(withFilter(onPageThree, { page: 5 }).page).toBe(5);
  });

  it('normalises lastVisit "any" to undefined ("no filter")', () => {
    expect(withFilter(LIST_QUERY_DEFAULTS, { lastVisit: 'any' }).lastVisit).toBeUndefined();
  });
});

describe('clearFilters', () => {
  it('keeps the saved view, the page size, and the sort/direction, resets the rest', () => {
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
    expect(clearFilters(query)).toEqual({
      ...LIST_QUERY_DEFAULTS,
      view: 'owing',
      size: 50,
      sort: 'age',
      dir: 'desc',
    });
  });
});

describe('parsePatientsSearch', () => {
  it('never throws and applies defaults for a bad view, page, size or dentist', () => {
    expect(parsePatientsSearch({ view: 'bogus' })).toMatchObject({ view: 'active' });
    expect(parsePatientsSearch({ page: 'abc' })).toMatchObject({ page: 1 });
    expect(parsePatientsSearch({ page: 0 })).toMatchObject({ page: 1 });
    expect(parsePatientsSearch({ size: 13 })).toMatchObject({ size: 25 });
    expect(parsePatientsSearch({ dentist: 'not-a-uuid' })).toMatchObject({ dentist: undefined });
  });

  it('never throws for garbage input at all', () => {
    expect(parsePatientsSearch(null)).toEqual(LIST_QUERY_DEFAULTS);
    expect(parsePatientsSearch('nonsense')).toEqual(LIST_QUERY_DEFAULTS);
    expect(parsePatientsSearch(42)).toEqual(LIST_QUERY_DEFAULTS);
  });

  it('coerces q/fullName/phone/panel back to strings when the router parsed them as numbers', () => {
    // TanStack Router's default search parser turns a numeric-looking value into a JS number.
    expect(parsePatientsSearch({ phone: 71123456 }).phone).toBe('71123456');
    expect(parsePatientsSearch({ q: 12345 }).q).toBe('12345');
    expect(parsePatientsSearch({ fullName: 2000 }).fullName).toBe('2000');
    expect(parsePatientsSearch({ panel: 12345 }).panel).toBe('12345');
  });

  it('drops q/fullName/phone/panel entirely for a type that is neither string nor number', () => {
    // Unlike `z.coerce.string()`, a boolean/object/array isn't silently stringified into
    // "true"/"[object Object]"/a joined list — it's treated as absent, like any other bad value.
    expect(parsePatientsSearch({ phone: true }).phone).toBeUndefined();
    expect(parsePatientsSearch({ q: { nested: 'x' } }).q).toBeUndefined();
    expect(parsePatientsSearch({ fullName: ['a', 'b'] }).fullName).toBeUndefined();
    expect(parsePatientsSearch({ panel: null }).panel).toBeUndefined();
  });

  it('still parses a fully valid search normally', () => {
    expect(parsePatientsSearch({ view: 'archived', q: 'jane', page: 2, size: 50 })).toMatchObject({
      view: 'archived',
      q: 'jane',
      page: 2,
      size: 50,
    });
  });

  it('normalises lastVisit "any" to undefined', () => {
    expect(parsePatientsSearch({ lastVisit: 'any' }).lastVisit).toBeUndefined();
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

  it('drops lastVisit "any" ("no filter") rather than putting it in the URL', () => {
    expect(toSearch({ ...LIST_QUERY_DEFAULTS, lastVisit: 'any' })).toEqual({});
  });
});

describe('listQueryOf', () => {
  it('drops the panel and create pre-fill fields, keeping the list query', () => {
    const search = parsePatientsSearch({ view: 'archived', q: 'rana', panel: 'new', phone: '03' });
    expect(listQueryOf(search)).toEqual({ ...LIST_QUERY_DEFAULTS, view: 'archived', q: 'rana' });
    expect(toSearch(listQueryOf(search))).toEqual({ view: 'archived', q: 'rana' });
  });
});

describe('sortPatch', () => {
  it('flips the direction of the sorted column without leaving the page', () => {
    const query = { ...LIST_QUERY_DEFAULTS, page: 3 };
    expect(withFilter(query, sortPatch(query, 'name'))).toMatchObject({ dir: 'desc', page: 3 });
  });

  it('starts a new column at its natural direction on page 1', () => {
    const query = { ...LIST_QUERY_DEFAULTS, page: 3 };
    expect(withFilter(query, sortPatch(query, 'balance'))).toMatchObject({
      sort: 'balance',
      dir: 'desc',
      page: 1,
    });
    expect(sortPatch(query, 'dentist')).toEqual({ sort: 'dentist', dir: 'asc' });
  });
});

describe('withoutBalanceViews', () => {
  it('leaves a query without balance views untouched', () => {
    const query = { ...LIST_QUERY_DEFAULTS, view: 'archived' as const, page: 2 };
    expect(withoutBalanceViews(query)).toBe(query);
  });

  it('turns Owes balance into Active and sort by balance into the name sort, on page 1', () => {
    const query = {
      ...LIST_QUERY_DEFAULTS,
      view: 'owing' as const,
      sort: 'balance' as const,
      dir: 'desc' as const,
      q: 'rana',
      page: 3,
    };
    expect(withoutBalanceViews(query)).toEqual({ ...LIST_QUERY_DEFAULTS, q: 'rana' });
  });
});
