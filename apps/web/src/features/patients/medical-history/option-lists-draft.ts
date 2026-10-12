import {
  type MedicalOption,
  type MedicalOptionBatch,
  type MedicalOptionKind,
  medicalOptionKey,
} from '@dcm/contracts';

/**
 * The Catalog's medical-history lists as they are edited (feature 10, V14): rows are changed in
 * place and saved in one batch, like the services and diagnoses. Pure: the tab holds the draft.
 */
export interface OptionRow {
  /** Stable while the tab is open: the option's id, or a made-up key for a new row. */
  key: string;
  id?: string | undefined;
  kind: MedicalOptionKind;
  name: string;
  active: boolean;
}

export interface OptionListsDraft {
  /** The lists as saved. */
  base: OptionRow[];
  rows: OptionRow[];
}

const toRow = ({ id, kind, name, active }: MedicalOption): OptionRow => ({
  key: id,
  id,
  kind,
  name,
  active,
});

export function draftFrom(options: readonly MedicalOption[]): OptionListsDraft {
  const rows = options.map(toRow);
  return { base: rows, rows };
}

export function addRow(
  draft: OptionListsDraft,
  kind: MedicalOptionKind,
  key: string,
): OptionListsDraft {
  return { ...draft, rows: [...draft.rows, { key, kind, name: '', active: true }] };
}

export function editRow(
  draft: OptionListsDraft,
  key: string,
  patch: Partial<Pick<OptionRow, 'name' | 'active'>>,
): OptionListsDraft {
  return {
    ...draft,
    rows: draft.rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
  };
}

/** Takes a row out of the draft: a new one that was never saved, or one the server removed. */
export function dropRow(draft: OptionListsDraft, key: string): OptionListsDraft {
  const without = (rows: OptionRow[]) => rows.filter((row) => row.key !== key);
  return { base: without(draft.base), rows: without(draft.rows) };
}

/** A row the server changed outside a batch (Mark inactive) becomes its saved state. */
export function applyOption(draft: OptionListsDraft, option: MedicalOption): OptionListsDraft {
  const replace = (rows: OptionRow[]) =>
    rows.map((row) => (row.id === option.id ? toRow(option) : row));
  return { base: replace(draft.base), rows: replace(draft.rows) };
}

export function rowsOf(draft: OptionListsDraft, kind: MedicalOptionKind): OptionRow[] {
  return draft.rows.filter((row) => row.kind === kind);
}

/** New rows and rows whose name or active flag differs from the saved one. */
export function changedRows(draft: OptionListsDraft): OptionRow[] {
  const saved = new Map(draft.base.map((row) => [row.key, row]));
  return draft.rows.filter((row) => {
    const before = saved.get(row.key);
    return !before || before.name !== row.name.trim() || before.active !== row.active;
  });
}

/** Rows without a name: they block saving. */
export function missingCount(draft: OptionListsDraft): number {
  return draft.rows.filter((row) => row.name.trim() === '').length;
}

/** The keys of the rows whose name is already in their list, whatever its case. */
export function duplicateKeys(draft: OptionListsDraft): Set<string> {
  const seen = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const row of draft.rows) {
    if (row.name.trim() === '') continue;
    const name = medicalOptionKey(row);
    const first = seen.get(name);
    if (first === undefined) seen.set(name, row.key);
    else {
      duplicates.add(first);
      duplicates.add(row.key);
    }
  }
  return duplicates;
}

/** The batch a save sends: the changed rows, whole. */
export function batchOf(rows: readonly OptionRow[]): MedicalOptionBatch {
  return {
    items: rows.map(({ id, kind, name, active }) => ({
      ...(id === undefined ? {} : { id }),
      kind,
      name: name.trim(),
      active,
    })),
  };
}
