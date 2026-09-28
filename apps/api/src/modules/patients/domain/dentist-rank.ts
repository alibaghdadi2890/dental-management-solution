import type { PatientRankKeys } from './rank-keys';

/** A practitioner as `users` returns it: `id` is the staff profile id (ADR-0020). */
interface NamedDentist {
  id: string;
  displayName: string;
}

/**
 * The `sort=dentist` keys. `dentists` arrive in display-name order (as `UsersService` returns
 * them). Dentists whose names are equal under the tenant-locale collation (base sensitivity, the
 * one `users` sorts with) share a key — a dense rank — so their patients interleave by patient
 * name instead of being grouped by an arbitrary id. `desc` reverses the keys. Patients without a
 * dentist (or with one `users` doesn't know) get `restKey`, the largest key + 1: last in both
 * directions.
 */
export function dentistRank(
  dentists: readonly NamedDentist[],
  dir: 'asc' | 'desc',
  locale: string,
): PatientRankKeys {
  const collator = new Intl.Collator(locale, { sensitivity: 'base' });
  const ascending: number[] = [];
  dentists.forEach((dentist, index) => {
    const previous = dentists[index - 1];
    const previousKey = ascending[index - 1] ?? 0;
    const sameName =
      previous !== undefined && collator.compare(previous.displayName, dentist.displayName) === 0;
    ascending.push(sameName ? previousKey : previousKey + 1);
  });
  const max = ascending.at(-1) ?? 0;
  return {
    ids: dentists.map((dentist) => dentist.id),
    keys: dir === 'asc' ? ascending : ascending.map((key) => max + 1 - key),
    restKey: max + 1,
  };
}
