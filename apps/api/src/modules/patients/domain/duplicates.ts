/** The shape `groupDuplicates` needs; `PatientsRepository.duplicateRows()` returns `DomainPatient[]`. */
export interface DuplicateCandidate {
  nameKey: string;
  dateOfBirth: string | null;
  displayNumber: string;
}

function displayNumberValue(displayNumber: string): number {
  return Number(displayNumber.slice(displayNumber.indexOf('-') + 1));
}

/**
 * Groups patients sharing a `nameKey` and a non-null `dateOfBirth`; a row with no date of birth
 * can never be grouped, since two people who share a name but whose birth date is unknown are not
 * provably the same duplicate. Only groups of 2 or more survive, each ordered by display number
 * in numeric order (`P-000010` sorts after `P-000009`, not before it as a string compare would).
 * Pure; no I/O (CLAUDE.md §4.5) — `PatientsRepository.duplicateRows()` does the ≥ 2 pre-filter in
 * SQL, but this function re-groups from scratch so it stays correct for any input.
 */
export function groupDuplicates<T extends DuplicateCandidate>(rows: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    if (row.dateOfBirth === null) continue;
    const key = `${row.nameKey}\u0000${row.dateOfBirth}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return Array.from(groups.values())
    .filter((group) => group.length >= 2)
    .map((group) =>
      [...group].sort(
        (a, b) => displayNumberValue(a.displayNumber) - displayNumberValue(b.displayNumber),
      ),
    );
}
