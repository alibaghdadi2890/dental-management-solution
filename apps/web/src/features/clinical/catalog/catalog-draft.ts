import {
  type ChargeUnit,
  type DiagnosisBatch,
  type DiagnosisItem,
  leastUsedMarkColor,
  MARK_PRIORITY_DEFAULT,
  type MarkColor,
  type MarkIcon,
  type ProblemDetails,
  type ServiceBatch,
  type ServiceItem,
  type ToothEffect,
} from '@dcm/contracts';
import { sanitizeAmountInput } from '@/lib/amount';

export type CatalogTab = 'services' | 'diagnoses';
export const CATALOG_TABS: readonly CatalogTab[] = ['services', 'diagnoses'];

/**
 * One editable row of either catalog. Diagnoses carry the service-only fields too (unused), so
 * the screen renders both tabs from one shape.
 */
export interface DraftRow {
  /** The id for saved rows; a local key until a new row is saved. */
  key: string;
  id?: string;
  code: string;
  name: string;
  /** '' = no category. */
  category: string;
  chargeUnit: ChargeUnit;
  /** Decimal amount as typed. */
  price: string;
  /** The saved price's currency; null for new rows (the tenant's). */
  currency: string | null;
  frequent: boolean;
  active: boolean;
  /** What performing the service does to the tooth (H2); `none` unless it is charged per tooth. */
  toothEffect: ToothEffect;
  /** The chart mark (feature 9): a colour for a diagnosis and for a service charged per tooth.
   * Any other service is never on a tooth; it has none, or the one it had while it was. */
  color: MarkColor | null;
  /** Services charged per tooth only. */
  icon: MarkIcon | null;
  markPriority: number;
}

export type RowPatch = Partial<
  Pick<
    DraftRow,
    | 'code'
    | 'name'
    | 'category'
    | 'chargeUnit'
    | 'price'
    | 'frequent'
    | 'active'
    | 'toothEffect'
    | 'color'
    | 'icon'
    | 'markPriority'
  >
>;

/** The server snapshot (`base`) and the rows being edited, per tab. */
export interface CatalogDraft {
  base: Record<CatalogTab, DraftRow[]>;
  rows: Record<CatalogTab, DraftRow[]>;
}

type Item = ServiceItem | DiagnosisItem;

/** "30.00" → "30", "45.50" → "45.5": prices read as the POC shows them. */
export function plainAmount(amount: string): string {
  return amount.includes('.') ? amount.replace(/\.?0+$/, '') : amount;
}

function rowFrom(item: Item): DraftRow {
  const service = 'price' in item ? item : undefined;
  return {
    key: item.id,
    id: item.id,
    code: item.code,
    name: item.name,
    category: item.category ?? '',
    chargeUnit: service?.chargeUnit ?? 'per_tooth',
    price: service ? plainAmount(service.price.amount) : '0',
    currency: service?.price.currency ?? null,
    frequent: item.frequent,
    active: item.active,
    toothEffect: service?.toothEffect ?? 'none',
    color: item.color,
    icon: service?.icon ?? null,
    markPriority: item.markPriority,
  };
}

/** The colour a row of `tab` gets when it has none: the one the draft uses least (M13). */
function freeColor(draft: CatalogDraft, tab: CatalogTab): MarkColor {
  return leastUsedMarkColor(draft.rows[tab].map((row) => row.color));
}

export function draftFrom(
  services: readonly ServiceItem[],
  diagnoses: readonly DiagnosisItem[],
): CatalogDraft {
  const base = { services: services.map(rowFrom), diagnoses: diagnoses.map(rowFrom) };
  return { base, rows: { services: [...base.services], diagnoses: [...base.diagnoses] } };
}

const updateTab = (
  draft: CatalogDraft,
  tab: CatalogTab,
  update: (rows: DraftRow[]) => DraftRow[],
  updateBase: (rows: DraftRow[]) => DraftRow[] = (rows) => rows,
): CatalogDraft => ({
  base: { ...draft.base, [tab]: updateBase(draft.base[tab]) },
  rows: { ...draft.rows, [tab]: update(draft.rows[tab]) },
});

export function editRow(
  draft: CatalogDraft,
  tab: CatalogTab,
  key: string,
  patch: RowPatch,
): CatalogDraft {
  return updateTab(draft, tab, (rows) =>
    rows.map((row) => {
      if (row.key !== key) return row;
      const next = { ...row, ...patch };
      // A service that becomes one on a tooth needs a colour.
      if (next.chargeUnit === 'per_tooth') {
        return next.color === null ? { ...next, color: freeColor(draft, tab) } : next;
      }
      // Only a per-tooth service changes a tooth: a row that stops being one loses its effect.
      // Its mark stays (the row no longer shows it): tooth records made with it are still drawn.
      return { ...next, toothEffect: 'none' };
    }),
  );
}

/** A new row at the top (POC): blank code for services, `DX-` for diagnoses. */
export function addRow(
  draft: CatalogDraft,
  tab: CatalogTab,
  key: string,
  category: string,
): CatalogDraft {
  const row: DraftRow = {
    key,
    code: tab === 'diagnoses' ? 'DX-' : '',
    name: '',
    category,
    chargeUnit: 'per_tooth',
    price: '0',
    currency: null,
    frequent: false,
    active: true,
    toothEffect: 'none',
    // Never colourless, however quickly it is added.
    color: freeColor(draft, tab),
    icon: null,
    markPriority: MARK_PRIORITY_DEFAULT,
  };
  return updateTab(draft, tab, (rows) => [row, ...rows]);
}

/** Discard: back to the server snapshot in both tabs. */
export function discarded(draft: CatalogDraft): CatalogDraft {
  return {
    base: draft.base,
    rows: { services: [...draft.base.services], diagnoses: [...draft.base.diagnoses] },
  };
}

/** Removes a row that exists only in the draft. */
export function dropRow(draft: CatalogDraft, tab: CatalogTab, key: string): CatalogDraft {
  return updateTab(draft, tab, (rows) => rows.filter((row) => row.key !== key));
}

const sameAmount = (a: string, b: string) => Number(a || '0') === Number(b || '0');

export function isRowChanged(draft: CatalogDraft, tab: CatalogTab, row: DraftRow): boolean {
  const saved = draft.base[tab].find((candidate) => candidate.key === row.key);
  if (!saved) return true;
  const common =
    saved.code !== row.code ||
    saved.name !== row.name ||
    saved.category !== row.category ||
    saved.frequent !== row.frequent ||
    saved.active !== row.active ||
    saved.color !== row.color ||
    saved.markPriority !== row.markPriority;
  if (tab === 'diagnoses') return common;
  return (
    common ||
    saved.icon !== row.icon ||
    saved.chargeUnit !== row.chargeUnit ||
    saved.toothEffect !== row.toothEffect ||
    !sameAmount(saved.price, row.price)
  );
}

export function changedRows(draft: CatalogDraft, tab: CatalogTab): DraftRow[] {
  return draft.rows[tab].filter((row) => isRowChanged(draft, tab, row));
}

/** "N unsaved changes" counts both tabs, as in the POC. */
export function changeCount(draft: CatalogDraft): number {
  return CATALOG_TABS.reduce((sum, tab) => sum + changedRows(draft, tab).length, 0);
}

export const isMissingCodeOrName = (row: DraftRow) =>
  row.code.trim() === '' || row.name.trim() === '';

/** Rows that block saving: "N rows missing a code or name" (both tabs). */
export function missingCount(draft: CatalogDraft): number {
  return CATALOG_TABS.reduce(
    (sum, tab) => sum + draft.rows[tab].filter(isMissingCodeOrName).length,
    0,
  );
}

/**
 * Changed rows whose code another row of the tab holds (the server's rule, case-insensitive), with
 * the row-level message. Checked on the edited state, so swapping two codes is fine.
 */
export function duplicateCodes(draft: CatalogDraft, tab: CatalogTab): Map<string, string> {
  const rows = draft.rows[tab];
  const result = new Map<string, string>();
  for (const row of changedRows(draft, tab)) {
    const code = row.code.trim().toLowerCase();
    if (code === '') continue;
    const other = rows.find(
      (candidate) => candidate.key !== row.key && candidate.code.trim().toLowerCase() === code,
    );
    if (other) {
      result.set(
        row.key,
        `Code ${other.code.trim().toUpperCase()} is already used by "${other.name.trim()}"`,
      );
    }
  }
  return result;
}

/** The filter pills: distinct categories in order of first appearance. */
export function categoriesOf(rows: readonly DraftRow[]): string[] {
  return [...new Set(rows.map((row) => row.category.trim()).filter((category) => category))];
}

/** Keeps digits and one dot, at most two decimals — locale-aware (a French `,` decimal, Arabic-
 * Indic digits) via the shared `sanitizeAmountInput` (`lib/amount.ts`); a bare trailing/leading
 * dot is left exactly as typed here (the price is still being typed). */
export function sanitizePrice(value: string, locale: string): string {
  return sanitizeAmountInput(value, locale);
}

export function batchOf(tab: 'services', rows: readonly DraftRow[]): ServiceBatch;
export function batchOf(tab: 'diagnoses', rows: readonly DraftRow[]): DiagnosisBatch;
export function batchOf(tab: CatalogTab, rows: readonly DraftRow[]): ServiceBatch | DiagnosisBatch;
export function batchOf(tab: CatalogTab, rows: readonly DraftRow[]): ServiceBatch | DiagnosisBatch {
  const common = (row: DraftRow) => ({
    ...(row.id === undefined ? {} : { id: row.id }),
    code: row.code.trim().toUpperCase(),
    name: row.name.trim(),
    category: row.category.trim() || null,
  });
  if (tab === 'diagnoses') {
    return {
      items: rows.map((row) => ({
        ...common(row),
        frequent: row.frequent,
        active: row.active,
        color: row.color,
        markPriority: row.markPriority,
      })),
    };
  }
  return {
    items: rows.map((row) => ({
      ...common(row),
      chargeUnit: row.chargeUnit,
      price: row.price.replace(/\.$/, '') || '0',
      frequent: row.frequent,
      active: row.active,
      toothEffect: row.toothEffect,
      color: row.color,
      icon: row.icon,
      markPriority: row.markPriority,
    })),
  };
}

/** After a save: the tab takes the server's catalog; the other tab keeps its edits. */
export function applySaved(
  draft: CatalogDraft,
  tab: CatalogTab,
  items: readonly Item[],
): CatalogDraft {
  const rows = items.map(rowFrom);
  return updateTab(
    draft,
    tab,
    () => [...rows],
    () => rows,
  );
}

/** A delete applied immediately (K7): the row leaves both the snapshot and the draft. */
export function applyDeleted(draft: CatalogDraft, tab: CatalogTab, id: string): CatalogDraft {
  const without = (rows: DraftRow[]) => rows.filter((row) => row.key !== id);
  return updateTab(draft, tab, without, without);
}

/** "Mark inactive" applied immediately; other unsaved edits of the row survive. */
export function applyDeactivated(draft: CatalogDraft, tab: CatalogTab, item: Item): CatalogDraft {
  const saved = rowFrom(item);
  return updateTab(
    draft,
    tab,
    (rows) => rows.map((row) => (row.key === item.id ? { ...row, active: false } : row)),
    (rows) => rows.map((row) => (row.key === item.id ? saved : row)),
  );
}

/** A 422's `items.<i>.<field>` errors, mapped back to the keys of the rows that were sent. */
export function serverRowErrors(
  sent: readonly DraftRow[],
  errors: ProblemDetails['errors'],
): Map<string, string> {
  const result = new Map<string, string>();
  for (const error of errors ?? []) {
    const index = /^items\.(\d+)\./.exec(error.path)?.[1];
    const row = index === undefined ? undefined : sent[Number(index)];
    if (row && !result.has(row.key)) {
      result.set(row.key, error.message);
    }
  }
  return result;
}
