import type { InventoryItem } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { parseInventorySearch } from './inventory-search';
import { draftOf, inputOf } from './items-draft';
import { emptyQuantity, unitsOf } from './quantities';
import { matchesItem } from './item-match';

const gloves = { unit: 'piece', packName: 'box', packSize: 100 };

describe('a quantity typed in packs or units', () => {
  it('starts in packs for an item with a pack, in units otherwise', () => {
    expect(emptyQuantity(gloves).mode).toBe('pack');
    expect(emptyQuantity({ unit: 'bottle', packName: null, packSize: null }).mode).toBe('unit');
  });

  it('turns what was typed into units, whole numbers above zero only', () => {
    expect(unitsOf({ text: '5', mode: 'pack' }, gloves)).toBe(500);
    expect(unitsOf({ text: '5', mode: 'unit' }, gloves)).toBe(5);
    expect(unitsOf({ text: '0', mode: 'unit' }, gloves)).toBeNull();
    expect(unitsOf({ text: '2.5', mode: 'pack' }, gloves)).toBeNull();
    expect(unitsOf({ text: '', mode: 'pack' }, gloves)).toBeNull();
  });
});

describe('finding an item at once', () => {
  it('matches a name or a code, case and accents aside', () => {
    expect(matchesItem({ name: 'Nitrile gloves M', code: 'GL-M' }, 'nitrile')).toBe(true);
    expect(matchesItem({ name: 'Nitrile gloves M', code: 'GL-M' }, 'gl-m')).toBe(true);
    expect(matchesItem({ name: 'Crème', code: null }, 'creme')).toBe(true);
    expect(matchesItem({ name: 'Lidocaine', code: null }, 'gloves')).toBe(false);
    expect(matchesItem({ name: 'Lidocaine', code: null }, '  ')).toBe(true);
  });
});

describe('the Inventory URL', () => {
  it('keeps what it knows and drops the rest', () => {
    expect(
      parseInventorySearch({ tab: 'receipts', status: 'low', toPrice: true, nonsense: 'x' }),
    ).toEqual({ tab: 'receipts', status: 'low', toPrice: true });
    expect(parseInventorySearch({ tab: 'nope', status: 'weird' })).toEqual({});
  });

  it('keeps a period only when it is whole and in order', () => {
    expect(parseInventorySearch({ from: '2026-11-01', to: '2026-11-30' })).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(parseInventorySearch({ from: '2026-11-30', to: '2026-11-01' })).toEqual({});
  });
});

describe('the items editor', () => {
  const item: InventoryItem = {
    id: '0195f000-0000-7000-8000-000000000001',
    name: 'Lidocaine 2%',
    code: null,
    categoryId: '0195f000-0000-7000-8000-000000000002',
    unit: 'carpule',
    packName: 'box',
    packSize: 50,
    reorderLevel: 100,
    usualSupplierId: null,
    usualOrderPacks: 4,
    tracksExpiry: true,
    note: null,
    active: true,
    moved: true,
  };

  it('sends back what it was given when nothing changed', () => {
    expect(inputOf(draftOf(item))).toEqual({
      id: item.id,
      name: 'Lidocaine 2%',
      code: null,
      categoryId: item.categoryId,
      unit: 'carpule',
      packName: 'box',
      packSize: 50,
      reorderLevel: 100,
      usualSupplierId: null,
      usualOrderPacks: 4,
      tracksExpiry: true,
      note: null,
      active: true,
    });
  });

  it('turns empty cells into nothing and numbers into numbers', () => {
    const row = { ...draftOf(item), reorderLevel: '', usualOrderPacks: '6', code: ' LID ' };
    expect(inputOf(row)).toMatchObject({ reorderLevel: null, usualOrderPacks: 6, code: 'LID' });
  });
});
