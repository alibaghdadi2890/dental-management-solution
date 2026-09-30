import { describe, expect, it } from 'vitest';
import { type DrawerItem, drawerCategories, drawerGroups } from './drawer-list';

const item = (name: string, category: string | null, frequent = false): DrawerItem => ({
  name,
  code: name.slice(0, 3).toUpperCase(),
  category,
  frequent,
});

const CATALOG = [
  item('Composite filling', 'Restorative', true),
  item('Zircon crown', 'Prosthetic'),
  item('Amalgam filling', 'Restorative'),
  item('Extraction', 'Surgical', true),
  item('Consultation', null),
];

const names = (items: readonly DrawerItem[]) => items.map((row) => row.name);

describe('drawerCategories', () => {
  it('lists the distinct categories in catalog order, skipping rows without one', () => {
    expect(drawerCategories(CATALOG)).toEqual(['Restorative', 'Prosthetic', 'Surgical']);
  });
});

describe('drawerGroups', () => {
  it('without a query or category: Frequently used, then each category, then the rest', () => {
    const groups = drawerGroups(CATALOG, '', null);
    expect(groups.map((group) => group.heading)).toEqual([
      { kind: 'frequent' },
      { kind: 'category', category: 'Restorative' },
      { kind: 'category', category: 'Prosthetic' },
      { kind: 'category', category: 'Surgical' },
      { kind: 'uncategorized' },
    ]);
    expect(names(groups[0]?.items ?? [])).toEqual(['Composite filling', 'Extraction']);
    expect(names(groups[1]?.items ?? [])).toEqual(['Composite filling', 'Amalgam filling']);
    expect(names(groups[4]?.items ?? [])).toEqual(['Consultation']);
  });

  it('leaves Frequently used out when nothing is flagged', () => {
    const groups = drawerGroups([item('Scaling', 'Periodontal')], '', null);
    expect(groups.map((group) => group.heading.kind)).toEqual(['category']);
  });

  it('with a query: one group headed by the match count, name or code, any case', () => {
    const groups = drawerGroups(CATALOG, '  FILL ', null);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.heading).toEqual({ kind: 'matches', count: 2 });
    expect(names(groups[0]?.items ?? [])).toEqual(['Composite filling', 'Amalgam filling']);
    expect(names(drawerGroups(CATALOG, 'zir', null)[0]?.items ?? [])).toEqual(['Zircon crown']);
  });

  it('with a category: one group headed by its name', () => {
    const groups = drawerGroups(CATALOG, '', 'Restorative');
    expect(groups.map((group) => group.heading)).toEqual([
      { kind: 'category', category: 'Restorative' },
    ]);
    expect(names(groups[0]?.items ?? [])).toEqual(['Composite filling', 'Amalgam filling']);
  });

  it('a query within a category counts the matches in that category only', () => {
    const groups = drawerGroups(CATALOG, 'a', 'Restorative');
    expect(groups[0]?.heading).toEqual({ kind: 'matches', count: 1 });
    expect(names(groups[0]?.items ?? [])).toEqual(['Amalgam filling']);
  });

  it('is empty when nothing matches', () => {
    expect(drawerGroups(CATALOG, 'veneer', null)).toEqual([]);
  });
});
