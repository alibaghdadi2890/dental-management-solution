import {
  AGE_BANDS,
  idSchema,
  PATIENT_PAGE_SIZES,
  patientListQuerySchema,
  patientSortSchema,
  patientViewSchema,
  type PatientListQuery,
} from '@dcm/contracts';
import type { HistoryState } from '@tanstack/react-router';
import { z } from 'zod';

/**
 * The `/patients` route's URL search: the shared list query (already carrying its own defaults
 * and blank-tolerance, `patientListQuerySchema`) plus the right-panel `panel` token. This is the
 * *strict* schema — it throws on an invalid field, exactly like `patientListQuerySchema` does.
 * `routes/_app/patients/index.tsx`'s `validateSearch` calls `parsePatientsSearch` instead, which
 * never throws; this schema is what that function parses into once every field is already
 * known-valid-or-absent.
 *
 * The create panel's pre-fill (a name or phone typed into the ⌘K palette) is deliberately *not*
 * here: it is patient data, and a URL ends up in history, logs and shared links (CLAUDE.md §15).
 * It rides in history state instead (`HistoryState.patientPrefill`).
 */
export const patientsSearchSchema = patientListQuerySchema.extend({
  panel: z.string().optional(),
});
export type PatientsSearch = z.infer<typeof patientsSearchSchema>;

/** The shape a `<Link search>` may pass in — every field optional, since `parsePatientsSearch`
 * fills in whatever's missing. Exported separately from `PatientsSearch` (the fully-defaulted
 * *output*) because TanStack Router's `Link` needs the pre-default *input* type. */
export type PatientsSearchInput = z.input<typeof patientsSearchSchema>;

/** `patientListQuerySchema`'s own defaults, kept here once so `toSearch`/`clearFilters` agree and
 * so `stripSearchParams` (the route's search middleware) can drop them from the URL. */
export const LIST_QUERY_DEFAULTS: PatientListQuery = patientListQuerySchema.parse({});

/** Parses a field but turns any invalid raw value into `undefined` instead of throwing, so one
 * bad query param — a stale bookmark, a hand-edited URL, or TanStack Router's own search parser
 * turning a numeric-looking value (e.g. `?q=71123456`) into a JS `number` — can't blank the
 * whole route with a thrown error. `patientsSearchSchema`'s own default then takes over exactly as
 * it would for an absent field. */
function lenient<T extends z.ZodType>(schema: T) {
  return schema.optional().catch(undefined);
}

const pageSizeSchema = z.union([
  z.literal(PATIENT_PAGE_SIZES[0]),
  z.literal(PATIENT_PAGE_SIZES[1]),
  z.literal(PATIENT_PAGE_SIZES[2]),
]);

/** A string or a number (TanStack Router's default search parser infers a JS type per value, so a
 * numeric-looking `q` — a phone number *is* numeric-looking — arrives as a `number`, not a
 * `string`), turned into a string. Deliberately *not* `z.coerce.string()`: that
 * coerces anything (`true` → `"true"`, an object → `"[object Object]"`, an array → a comma-joined
 * string), which would silently accept nonsense a person never typed; a boolean/object/array here
 * should fall through `lenient`'s `.catch(undefined)` like any other wrong-shaped value instead. */
const stringLike = z.union([z.string(), z.number()]).transform(String);

/** Every field loosened per `lenient`. */
const rawSearchSchema = z.object({
  view: lenient(patientViewSchema),
  q: lenient(stringLike.pipe(z.string().trim().max(100))),
  dentist: lenient(z.union([idSchema, z.literal('none')])),
  age: lenient(z.enum(AGE_BANDS)),
  alerts: lenient(z.enum(['yes', 'no'])),
  lastVisit: lenient(z.enum(['any', 'never'])),
  sort: lenient(patientSortSchema),
  dir: lenient(z.enum(['asc', 'desc'])),
  page: lenient(z.coerce.number().int().min(1)),
  size: lenient(z.coerce.number().pipe(pageSizeSchema)),
  panel: lenient(stringLike),
});

/** `lastVisit: 'any'` means "no filter" — the same as the field being absent (design Q14's "Any
 * time" option) — so every reader of a `PatientListQuery` (`activeFilterCount`, `toSearch`, the
 * API client's query string) only ever has to treat one of the two as "not filtering". */
function normalizeLastVisit<T extends Pick<PatientListQuery, 'lastVisit'>>(query: T): T {
  return query.lastVisit === 'any' ? { ...query, lastVisit: undefined } : query;
}

/**
 * Safe to call with anything TanStack Router hands `validateSearch` — untyped, and possibly with
 * the wrong JS type per field or an invalid enum/id from a stale bookmark. Never throws: an
 * invalid field is dropped and the list query's own default takes over, exactly as an absent
 * field would (the outer `try`/`catch` is a last-resort net; `rawSearchSchema`'s per-field
 * `.catch()` already keeps the common bad-URL cases — a bad `view`, `page=0`, `size=13`, a
 * non-uuid `dentist` — from ever reaching it).
 */
export function parsePatientsSearch(raw: unknown): PatientsSearch {
  try {
    const loose = rawSearchSchema.parse(raw && typeof raw === 'object' ? raw : {});
    return normalizeLastVisit(patientsSearchSchema.parse(loose));
  } catch {
    return { ...LIST_QUERY_DEFAULTS };
  }
}

/** The list query inside the route search — without `panel`, which must never reach
 * `GET /patients`, its query key, or the "selection resets on query change" key. */
export function listQueryOf(search: PatientsSearch): PatientListQuery {
  const { view, q, dentist, age, alerts, lastVisit, sort, dir, page, size } = search;
  return { view, q, dentist, age, alerts, lastVisit, sort, dir, page, size };
}

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

/** What the create panel starts with (design "digits → phone, otherwise name"). */
export interface PatientPrefill {
  fullName?: string;
  phone?: string;
}

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** On the history entry that opening a panel from the list pushed: closing that panel goes
     * back to the entry before it instead of adding a second, identical list entry. */
    patientsPanelPushed?: boolean;
    /** The create panel's pre-fill (see `patientsSearchSchema`: never in the URL). */
    patientPrefill?: PatientPrefill;
  }
}

/** A `/patients` location: its (unparsed) search and its history state. */
export interface PatientsLocation {
  search: unknown;
  state: HistoryState;
}

export type PanelNavigation =
  | { kind: 'back' }
  | { kind: 'navigate'; search: PatientsSearch; replace: boolean; panelPushed: boolean };

/**
 * How to open, swap or close the right panel from `location` (`null` when not on `/patients`
 * at all), keeping the list query. Opening a panel over the bare list pushes an entry marked
 * `panelPushed`; swapping an open panel replaces its entry and keeps its mark; closing a panel the
 * list pushed goes back (so Back afterwards leaves the list rather than landing on the same list
 * again), and closing any other — a shared link, or a filter changed while it was open — replaces
 * its entry. From another screen it is a plain push over the default list, never marked: going
 * back from there would leave `/patients` altogether.
 */
export function panelNavigation(
  location: PatientsLocation | null,
  panel: PatientPanel | null,
): PanelNavigation {
  const current = parsePatientsSearch(location?.search ?? {});
  const open = location !== null && parsePanel(current.panel) !== null;
  const pushed = open && location.state.patientsPanelPushed === true;
  if (panel === null && pushed) return { kind: 'back' };
  return {
    kind: 'navigate',
    search: { ...listQueryOf(current), panel: panelParam(panel) },
    replace: open,
    panelPushed: location !== null && panel !== null && (!open || pushed),
  };
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
  const normalized = normalizeLastVisit(query);
  return CHIP_FIELDS.reduce((count, field) => count + (normalized[field] ? 1 : 0), 0);
}

const RESETTING_KEYS = [
  'q',
  'dentist',
  'age',
  'alerts',
  'lastVisit',
  'view',
  'sort',
  'size',
] as const;

/**
 * Applies a filter/search/view/sort/size edit. Changing what's shown or how many rows fit on a
 * page always jumps back to page 1 — the current page number from a different result set (or a
 * different page size) is meaningless. Flipping `dir` on the same sort column, or setting `page`
 * directly (the pager's own buttons), does not reset paging itself.
 */
export function withFilter(
  query: PatientListQuery,
  patch: Partial<PatientListQuery>,
): PatientListQuery {
  const normalizedPatch = normalizeLastVisit(patch);
  const merged = { ...query, ...normalizedPatch };
  const resets = RESETTING_KEYS.some((key) => key in patch);
  return resets ? { ...merged, page: 1 } : merged;
}

/** "Clear filters": keeps the saved-view tab, the chosen page size, and the current sort/direction
 * — only the search box and the filter chips are cleared (which also resets the page to 1, since
 * clearing filters changes the result set). */
export function clearFilters(query: PatientListQuery): PatientListQuery {
  return {
    ...LIST_QUERY_DEFAULTS,
    view: query.view,
    size: query.size,
    sort: query.sort,
    dir: query.dir,
  };
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
  const normalized = normalizeLastVisit(query);
  const result: Partial<PatientListQuery> = {};
  for (const key of Object.keys(normalized) as (keyof PatientListQuery)[]) {
    copyIfChanged(result, normalized, key);
  }
  return result;
}

/**
 * Without `payment:read` the billing route that serves the Owes balance view and sort by balance
 * answers 403, so those fall back to the Active view and the default name sort (page 1) instead
 * of an error. Returns `query` itself when nothing needs to change.
 */
export function withoutBalanceViews(query: PatientListQuery): PatientListQuery {
  const owing = query.view === 'owing';
  const byBalance = query.sort === 'balance';
  if (!owing && !byBalance) return query;
  return withFilter(query, {
    ...(owing ? { view: LIST_QUERY_DEFAULTS.view } : {}),
    ...(byBalance ? { sort: LIST_QUERY_DEFAULTS.sort, dir: LIST_QUERY_DEFAULTS.dir } : {}),
  });
}

/** The columns a header click can sort by (`recent` is the palette's order, not a column). */
export type SortableColumn = Exclude<PatientListQuery['sort'], 'recent'>;

/** First click on a column sorts names A→Z, ages oldest first and balances largest first (POC). */
const FIRST_DIR: Record<SortableColumn, PatientListQuery['dir']> = {
  name: 'asc',
  age: 'desc',
  dentist: 'asc',
  balance: 'desc',
};

/** The patch a header click applies (through `withFilter`): the sorted column flips direction —
 * staying on the same page — and a new column starts at its natural direction on page 1. */
export function sortPatch(
  query: PatientListQuery,
  column: SortableColumn,
): Partial<PatientListQuery> {
  if (query.sort === column) return { dir: query.dir === 'asc' ? 'desc' : 'asc' };
  return { sort: column, dir: FIRST_DIR[column] };
}
