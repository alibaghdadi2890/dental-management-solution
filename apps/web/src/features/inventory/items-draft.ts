import type { InventoryItem, ItemInputRequest } from '@dcm/contracts';

/** One row of the editor: the item as typed, text for the numbers. */
export interface DraftItem {
  key: string;
  id: string | undefined;
  moved: boolean;
  name: string;
  code: string;
  categoryId: string;
  unit: string;
  packName: string;
  packSize: string;
  reorderLevel: string;
  usualSupplierId: string;
  usualOrderPacks: string;
  tracksExpiry: boolean;
  note: string;
  active: boolean;
}

export function draftOf(item: InventoryItem): DraftItem {
  const text = (value: number | null) => (value === null ? '' : String(value));
  return {
    key: item.id,
    id: item.id,
    moved: item.moved,
    name: item.name,
    code: item.code ?? '',
    categoryId: item.categoryId,
    unit: item.unit,
    packName: item.packName ?? '',
    packSize: text(item.packSize),
    reorderLevel: text(item.reorderLevel),
    usualSupplierId: item.usualSupplierId ?? '',
    usualOrderPacks: text(item.usualOrderPacks),
    tracksExpiry: item.tracksExpiry,
    note: item.note ?? '',
    active: item.active,
  };
}

/** What a draft row sends (`PUT /inventory/items`); the server validates the rest. */
export function inputOf(row: DraftItem): ItemInputRequest {
  const number = (text: string) => (text.trim() === '' ? null : Number(text.trim()));
  const blank = (text: string) => (text.trim() === '' ? null : text.trim());
  return {
    ...(row.id ? { id: row.id } : {}),
    name: row.name.trim(),
    code: blank(row.code),
    categoryId: row.categoryId,
    unit: row.unit.trim(),
    packName: blank(row.packName),
    packSize: number(row.packSize),
    reorderLevel: number(row.reorderLevel),
    usualSupplierId: blank(row.usualSupplierId),
    usualOrderPacks: number(row.usualOrderPacks),
    tracksExpiry: row.tracksExpiry,
    note: blank(row.note),
    active: row.active,
  };
}

export const same = (a: DraftItem, b: DraftItem) =>
  JSON.stringify(inputOf(a)) === JSON.stringify(inputOf(b));
