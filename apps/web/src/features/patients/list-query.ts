import { patientListQuerySchema, type PatientListQuery } from '@dcm/contracts';
import { z } from 'zod';

/**
 * The `/patients` route's URL search: the shared list query (already carrying its own defaults
 * and blank-tolerance, `patientListQuerySchema`) plus the right-panel `panel` token and the two
 * fields the shell's "New patient" / palette "Create …" pre-fill (design "Create pre-filled with
 * digits → phone, otherwise name"). `validateSearch` on `routes/_app/patients/index.tsx` parses
 * with this schema directly, so an unknown query param is silently dropped and a blank one behaves
 * like an absent one, exactly as the list query itself does.
 */
export const patientsSearchSchema = patientListQuerySchema.extend({
  panel: z.string().optional(),
  fullName: z.string().optional(),
  phone: z.string().optional(),
});
export type PatientsSearch = z.infer<typeof patientsSearchSchema>;

/** `patientListQuerySchema`'s own defaults, kept here once so `toSearch`/`clearFilters` agree. */
export const LIST_QUERY_DEFAULTS: PatientListQuery = patientListQuerySchema.parse({});

export type PatientPanel =
  | { kind: 'new' }
  | { kind: 'edit'; id: string }
  | { kind: 'quick'; id: string }
  | { kind: 'merge'; ids: readonly [string, string] };

/**
 * Parses the `panel` search param (README: `?panel=new`, `?panel=edit:<id>`, quick view, and the
 * merge panel opened on a duplicate pair). Anything that doesn't match one of the four shapes —
 * an unknown kind, a missing id, or a merge pair of the same id twice — is not a panel, not an
 * error: the list just renders with none open.
 */
export function parsePanel(panel: string | undefined | null): PatientPanel | null {
  if (!panel) return null;
  if (panel === 'new') return { kind: 'new' };

  const editId = /^edit:(.+)$/.exec(panel)?.[1];
  if (editId) return { kind: 'edit', id: editId };

  const quickId = /^quick:(.+)$/.exec(panel)?.[1];
  if (quickId) return { kind: 'quick', id: quickId };

  const merge = /^merge:([^,]+),([^,]+)$/.exec(panel);
  const [a, b] = [merge?.[1], merge?.[2]];
  if (a && b) return a === b ? null : { kind: 'merge', ids: [a, b] };

  return null;
}

/** The inverse of `parsePanel`; `null` clears the panel (omit the param from the URL search). */
export function panelParam(panel: PatientPanel | null): string | undefined {
  if (!panel) return undefined;
  switch (panel.kind) {
    case 'new':
      return 'new';
    case 'edit':
      return `edit:${panel.id}`;
    case 'quick':
      return `quick:${panel.id}`;
    case 'merge':
      return `merge:${panel.ids[0]},${panel.ids[1]}`;
  }
}

/** The chip/search fields the filter bar's "Clear filters" and its tinted-chip state track. */
const CHIP_FIELDS = ['q', 'dentist', 'age', 'alerts', 'lastVisit'] as const;

/**
 * Counts the search box plus each filter chip currently away from its default (design "a chip
 * that differs from its default is tinted; 'Clear filters' when any is active"). `view` (a saved
 * tab, not a chip), `sort`/`dir` (column header state) and `page`/`size` (paging) are deliberately
 * not counted — none of them has a visible "chip" the filter bar tints or a "Clear filters" click
 * should reset.
 */
export function activeFilterCount(query: PatientListQuery): number {
  return CHIP_FIELDS.reduce((count, field) => count + (query[field] ? 1 : 0), 0);
}

const RESETTING_KEYS = ['q', 'dentist', 'age', 'alerts', 'lastVisit', 'view', 'sort'] as const;

/**
 * Applies a filter/search/view/sort/paging edit. Changing what's shown (a filter, the search box,
 * the saved-view tab, or the sort column) always jumps back to page 1 — the current page number
 * from a different result set is meaningless. Flipping `dir` on the same sort column, or changing
 * `page`/`size` directly, does not reset paging itself.
 */
export function withFilter(
  query: PatientListQuery,
  patch: Partial<PatientListQuery>,
): PatientListQuery {
  const merged = { ...query, ...patch };
  const resets = RESETTING_KEYS.some((key) => key in patch);
  return resets ? { ...merged, page: 1 } : merged;
}

/** "Clear filters": back to every default except the saved-view tab and the chosen page size. */
export function clearFilters(query: PatientListQuery): PatientListQuery {
  return { ...LIST_QUERY_DEFAULTS, view: query.view, size: query.size };
}

/** A generic per-key copy so TypeScript ties `query[key]` and `result[key]` to the same `K`
 * instead of the union of every field's type (a plain `for…in` loop can't express that). */
function copyIfChanged<K extends keyof PatientListQuery>(
  result: Partial<PatientListQuery>,
  query: Pick<PatientListQuery, K>,
  key: K,
): void {
  const value = query[key];
  if (value !== undefined && value !== LIST_QUERY_DEFAULTS[key]) {
    result[key] = value;
  }
}

/** Strips values equal to the schema's own default, so the URL stays clean when nothing but the
 * saved view (say) has been touched. */
export function toSearch(query: PatientListQuery): Partial<PatientListQuery> {
  const result: Partial<PatientListQuery> = {};
  for (const key of Object.keys(query) as (keyof PatientListQuery)[]) {
    copyIfChanged(result, query, key);
  }
  return result;
}
