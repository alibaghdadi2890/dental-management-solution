export interface Nameable {
  authUserId: string;
  displayName: string;
}

/**
 * Stable display order for practitioner lists (`UsersService.listPractitioners`,
 * `practitionersByIds`, `practitionersByProfileIds`): display names compared with the tenant's
 * locale collation (diacritic- and case-insensitive, `sensitivity: 'base'`, so "Dr. Émile" sorts
 * next to "Dr. Zed" the way a person reading that locale would expect), then `authUserId` as a
 * deterministic tie-break when two staff share a display name. The tie-break uses the auth user
 * id rather than the staff profile id (ADR-0020): `(tenant_id, auth_user_id)` is unique on
 * `staff_profiles`, so either id gives a valid, deterministic order — `authUserId` is kept because
 * it is the field the existing practitioner-order tests and API consumers already pin. Pure; no
 * I/O (CLAUDE.md §4.5).
 */
export function sortByDisplayName<T extends Nameable>(items: readonly T[], locale: string): T[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base' });
  return [...items].sort((a, b) => {
    const byName = collator.compare(a.displayName, b.displayName);
    if (byName !== 0) return byName;
    return a.authUserId < b.authUserId ? -1 : a.authUserId > b.authUserId ? 1 : 0;
  });
}
