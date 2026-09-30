/**
 * The catalog drawer's list (workspace spec §Add Service / Plan Treatment / Diagnosis Drawer):
 * which rows show, under which headings. Pure, so the grouping rules are tested without the
 * drawer.
 */

/** What the grouping reads from a catalog row (a service or a diagnosis). */
export interface DrawerItem {
  name: string;
  code: string;
  category: string | null;
  frequent: boolean;
}

/** A group's heading: the drawer renders each kind with its own copy. */
export type DrawerHeading =
  | { kind: 'frequent' }
  | { kind: 'category'; category: string }
  | { kind: 'uncategorized' }
  | { kind: 'matches'; count: number };

export interface DrawerGroup<T extends DrawerItem> {
  heading: DrawerHeading;
  items: T[];
}

/** The category chips after "All": the distinct categories, in catalog order. */
export function drawerCategories(items: readonly DrawerItem[]): string[] {
  return [...new Set(items.map((item) => item.category).filter((category) => category !== null))];
}

const matches = (item: DrawerItem, query: string) =>
  item.name.toLocaleLowerCase().includes(query) || item.code.toLocaleLowerCase().includes(query);

/**
 * With no query and no category ("All"): **Frequently used** first, then each category in
 * catalog order, then the rows without one. With a query or a category: one group, headed
 * "`n` matches" for a query, else the category's name. Empty when nothing matches (the drawer's
 * "Nothing matches" copy). A frequent row shows twice under "All": once in Frequently used and
 * once in its category, as in the POC.
 */
export function drawerGroups<T extends DrawerItem>(
  items: readonly T[],
  query: string,
  category: string | null,
): DrawerGroup<T>[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle && category === null) {
    const frequent = items.filter((item) => item.frequent);
    const groups: DrawerGroup<T>[] = [];
    if (frequent.length > 0) groups.push({ heading: { kind: 'frequent' }, items: frequent });
    for (const name of drawerCategories(items)) {
      groups.push({
        heading: { kind: 'category', category: name },
        items: items.filter((item) => item.category === name),
      });
    }
    const loose = items.filter((item) => item.category === null);
    if (loose.length > 0) groups.push({ heading: { kind: 'uncategorized' }, items: loose });
    return groups;
  }
  const pool = items.filter(
    (item) => (category === null || item.category === category) && matches(item, needle),
  );
  if (pool.length === 0) return [];
  const heading: DrawerHeading =
    category !== null && !needle
      ? { kind: 'category', category }
      : { kind: 'matches', count: pool.length };
  return [{ heading, items: pool }];
}
