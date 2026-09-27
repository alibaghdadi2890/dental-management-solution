import type { DiagnosisItem, ServiceItem } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import {
  addRow,
  applyDeactivated,
  applyDeleted,
  applySaved,
  batchOf,
  categoriesOf,
  changeCount,
  changedRows,
  draftFrom,
  discarded,
  dropRow,
  duplicateCodes,
  editRow,
  isRowChanged,
  missingCount,
  plainAmount,
  sanitizePrice,
  serverRowErrors,
} from './catalog-draft';

const id = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d${String(n).padStart(2, '0')}`;

const service = (n: number, code: string, name: string, category: string | null): ServiceItem => ({
  id: id(n),
  code,
  name,
  category,
  chargeUnit: 'per_tooth',
  price: { amount: '30.00', currency: 'USD' },
  frequent: false,
  active: true,
});

const diagnosis = (n: number, code: string, name: string, category: string): DiagnosisItem => ({
  id: id(n),
  code,
  name,
  category,
  frequent: false,
  active: true,
});

const SERVICES = [
  service(1, 'EXT', 'Extraction', 'Surgical'),
  service(2, 'CMP', 'Composite', 'Restorative'),
  service(3, 'SCL', 'Scaling', null),
];
const DIAGNOSES = [diagnosis(11, 'DX-CAR', 'Dental caries', 'Caries')];
const fresh = () => draftFrom(SERVICES, DIAGNOSES);
const row = (draft: ReturnType<typeof fresh>, tab: 'services' | 'diagnoses', key: string) => {
  const found = draft.rows[tab].find((candidate) => candidate.key === key);
  if (!found) throw new Error(`no row ${key}`);
  return found;
};

describe('catalog draft', () => {
  it('starts clean, with server rows keyed by id', () => {
    const draft = fresh();
    expect(changeCount(draft)).toBe(0);
    expect(row(draft, 'services', id(1))).toMatchObject({
      id: id(1),
      code: 'EXT',
      category: 'Surgical',
      price: '30',
      currency: 'USD',
    });
    expect(row(draft, 'services', id(3)).category).toBe('');
  });

  it('marks an edited row dirty, and clean again when the edit is undone', () => {
    let draft = editRow(fresh(), 'services', id(1), { name: 'Simple extraction' });
    expect(isRowChanged(draft, 'services', row(draft, 'services', id(1)))).toBe(true);
    expect(changeCount(draft)).toBe(1);
    draft = editRow(draft, 'services', id(1), { name: 'Extraction' });
    expect(changeCount(draft)).toBe(0);
  });

  it('treats a price that only differs in format as unchanged', () => {
    const draft = editRow(fresh(), 'services', id(1), { price: '30' });
    expect(changeCount(draft)).toBe(0);
  });

  it('counts changes across both tabs, new rows included', () => {
    let draft = editRow(fresh(), 'diagnoses', id(11), { frequent: true });
    draft = addRow(draft, 'services', 'new-1', 'Implants');
    expect(changeCount(draft)).toBe(2);
    expect(draft.rows.services[0]).toMatchObject({
      key: 'new-1',
      code: '',
      category: 'Implants',
      chargeUnit: 'per_tooth',
      price: '0',
      currency: null,
      frequent: false,
      active: true,
    });
    expect(addRow(fresh(), 'diagnoses', 'new-2', '').rows.diagnoses[0]?.code).toBe('DX-');
  });

  it('discards every edit in both tabs', () => {
    let draft = editRow(fresh(), 'services', id(1), { name: 'x' });
    draft = addRow(draft, 'diagnoses', 'new-1', '');
    expect(changeCount(discarded(draft))).toBe(0);
    expect(discarded(draft).rows.diagnoses).toHaveLength(1);
  });

  it('drops a new row entirely', () => {
    const draft = dropRow(addRow(fresh(), 'services', 'new-1', ''), 'services', 'new-1');
    expect(draft.rows.services).toHaveLength(3);
    expect(changeCount(draft)).toBe(0);
  });

  it('counts rows missing a code or name in both tabs', () => {
    let draft = addRow(fresh(), 'services', 'new-1', '');
    draft = editRow(draft, 'diagnoses', id(11), { name: '  ' });
    expect(missingCount(draft)).toBe(2);
  });

  it('flags changed rows whose code another row holds, case-insensitively', () => {
    let draft = addRow(fresh(), 'services', 'new-1', '');
    draft = editRow(draft, 'services', 'new-1', { code: 'ext', name: 'Another' });
    expect(duplicateCodes(draft, 'services')).toEqual(
      new Map([['new-1', 'Code EXT is already used by "Extraction"']]),
    );
    // Swapping two codes is fine once both rows are edited.
    draft = editRow(fresh(), 'services', id(1), { code: 'CMP' });
    draft = editRow(draft, 'services', id(2), { code: 'EXT' });
    expect(duplicateCodes(draft, 'services').size).toBe(0);
  });

  it('lists categories in order of first appearance, new ones included', () => {
    const draft = addRow(fresh(), 'services', 'new-1', 'Implants');
    expect(categoriesOf(draft.rows.services)).toEqual(['Implants', 'Surgical', 'Restorative']);
  });

  it('builds the batch from changed rows only', () => {
    let draft = editRow(fresh(), 'services', id(2), { price: '55.5', category: ' ' });
    draft = addRow(draft, 'services', 'new-1', '');
    draft = editRow(draft, 'services', 'new-1', { code: 'IMPL', name: ' Implant ', price: '' });
    const rows = changedRows(draft, 'services');
    expect(batchOf('services', rows)).toEqual({
      items: [
        {
          code: 'IMPL',
          name: 'Implant',
          category: null,
          chargeUnit: 'per_tooth',
          price: '0',
          frequent: false,
          active: true,
        },
        {
          id: id(2),
          code: 'CMP',
          name: 'Composite',
          category: null,
          chargeUnit: 'per_tooth',
          price: '55.5',
          frequent: false,
          active: true,
        },
      ],
    });
    expect(
      batchOf(
        'diagnoses',
        changedRows(editRow(fresh(), 'diagnoses', id(11), { active: false }), 'diagnoses'),
      ),
    ).toEqual({
      items: [
        {
          id: id(11),
          code: 'DX-CAR',
          name: 'Dental caries',
          category: 'Caries',
          frequent: false,
          active: false,
        },
      ],
    });
  });

  it('replaces one tab with the saved catalog and keeps the other tab’s edits', () => {
    let draft = editRow(fresh(), 'services', id(1), { name: 'Simple extraction' });
    draft = editRow(draft, 'diagnoses', id(11), { name: 'Caries' });
    draft = applySaved(draft, 'services', [
      { ...service(1, 'EXT', 'Simple extraction', 'Surgical') },
      ...SERVICES.slice(1),
    ]);
    expect(changeCount(draft)).toBe(1);
    expect(row(draft, 'diagnoses', id(11)).name).toBe('Caries');
  });

  it('merges a delete and a deactivation without losing other edits', () => {
    let draft = editRow(fresh(), 'services', id(2), { name: 'Composite resin' });
    draft = editRow(draft, 'services', id(3), { frequent: true });
    draft = applyDeleted(draft, 'services', id(1));
    draft = applyDeactivated(draft, 'services', { ...SERVICES[2]!, active: false });
    expect(draft.rows.services.map((candidate) => candidate.key)).toEqual([id(2), id(3)]);
    expect(row(draft, 'services', id(3))).toMatchObject({ active: false, frequent: true });
    expect(changeCount(draft)).toBe(2);
  });

  it('maps server row errors back to the rows that were sent', () => {
    let draft = addRow(fresh(), 'services', 'new-1', '');
    draft = editRow(draft, 'services', 'new-1', { code: 'ZIR', name: 'Zircon' });
    draft = editRow(draft, 'services', id(2), { name: 'Composite resin' });
    const sent = changedRows(draft, 'services');
    expect(
      serverRowErrors(sent, [
        {
          path: 'items.0.code',
          code: 'duplicate',
          message: 'Code ZIR is already used by "Zircon crown"',
        },
        { path: 'items', code: 'duplicate', message: 'ignored: no row' },
      ]),
    ).toEqual(new Map([['new-1', 'Code ZIR is already used by "Zircon crown"']]));
  });
});

describe('plainAmount', () => {
  it.each([
    ['30.00', '30'],
    ['45.50', '45.5'],
    ['100', '100'],
    ['100.00', '100'],
    ['0.00', '0'],
  ])('%j → %j', (input, output) => {
    expect(plainAmount(input)).toBe(output);
  });
});

describe('sanitizePrice', () => {
  it.each([
    ['12', '12'],
    ['$1,250.505', '1250.50'],
    ['3.', '3.'],
    ['1.2.3', '1.23'],
    ['abc', ''],
  ])('%j → %j', (input, output) => {
    expect(sanitizePrice(input)).toBe(output);
  });
});
