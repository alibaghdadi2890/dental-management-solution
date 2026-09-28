export interface Nameable {
  authUserId: string;
  displayName: string;
}

/**
 * Stable display order for practitioner lists (`UsersService.listPractitioners`,
 * `practitionersByProfileIds`): display names compared with the tenant's locale collation
 * (diacritic- and case-insensitive, `sensitivity: 'base'`, so "Dr. Émile" sorts next to "Dr. Zed"
 * the way a person reading that locale would expect), then `authUserId` as a deterministic
 * tie-break — either id would do (ADR-0020). Pure; no I/O (CLAUDE.md §4.5).
 */
export function sortByDisplayName<T extends Nameable>(items: readonly T[], locale: string): T[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base' });
  return [...items].sort((a, b) => {
    const byName = collator.compare(a.displayName, b.displayName);
    if (byName !== 0) return byName;
    return a.authUserId < b.authUserId ? -1 : a.authUserId > b.authUserId ? 1 : 0;
  });
}
