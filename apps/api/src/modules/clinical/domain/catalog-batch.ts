import {
  type ValidationIssue,
  ValidationFailedError,
} from '../../../platform/kernel/validation-failed.error';

/** What the code rule needs to know about a catalog row. */
export interface CodedRow {
  id: string;
  code: string;
  name: string;
}

/**
 * Codes are unique per tenant and catalog, case-insensitively. Checked on the state *after* the
 * batch (`changes`, in request order, new rows already holding their ids), so a batch may swap or
 * free codes. Every changed row that collides is reported at `items.<index>.code`; the database's
 * unique index enforces the same rule.
 */
export function assertUniqueCodes(stored: readonly CodedRow[], changes: readonly CodedRow[]): void {
  const after = new Map(stored.map((row) => [row.id, row]));
  for (const change of changes) {
    after.set(change.id, change);
  }
  const byCode = new Map<string, CodedRow[]>();
  for (const row of after.values()) {
    const key = row.code.toLowerCase();
    byCode.set(key, [...(byCode.get(key) ?? []), row]);
  }

  const issues: ValidationIssue[] = [];
  changes.forEach((change, index) => {
    const other = byCode.get(change.code.toLowerCase())?.find((row) => row.id !== change.id);
    if (other) {
      issues.push({
        path: `items.${String(index)}.code`,
        code: 'duplicate',
        message: `Code ${other.code.toUpperCase()} is already used by "${other.name}"`,
      });
    }
  });
  if (issues.length > 0) {
    const rows = issues.length === 1 ? '1 row has' : `${String(issues.length)} rows have`;
    throw new ValidationFailedError(`${rows} a duplicate code`, issues);
  }
}
