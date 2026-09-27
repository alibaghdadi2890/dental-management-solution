import { describe, expect, it } from 'vitest';
import {
  catalogCodeSchema,
  diagnosisBatchSchema,
  diagnosisItemInputSchema,
  nonNegativeAmountSchema,
  serviceBatchSchema,
  serviceItemInputSchema,
  serviceItemSchema,
} from './catalog.js';

const ID_A = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';
const ID_B = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f';

const service = {
  code: 'ext',
  name: 'Extraction',
  category: 'Surgical',
  chargeUnit: 'per_tooth',
  price: '30',
};

describe('catalogCodeSchema', () => {
  it('trims and upper-cases codes, as the POC does while typing', () => {
    expect(catalogCodeSchema.parse('  dx-car ')).toBe('DX-CAR');
  });

  it.each(['', '   ', 'A'.repeat(21), 'EX T', '-EXT'])('rejects %j', (code) => {
    expect(catalogCodeSchema.safeParse(code).success).toBe(false);
  });
});

describe('nonNegativeAmountSchema', () => {
  it.each(['0', '30', '1250.5', '99.99'])('accepts %j', (amount) => {
    expect(nonNegativeAmountSchema.safeParse(amount).success).toBe(true);
  });

  it.each(['-1', '1.234', '', 'abc', '1e3'])('rejects %j', (amount) => {
    expect(nonNegativeAmountSchema.safeParse(amount).success).toBe(false);
  });
});

describe('serviceItemInputSchema', () => {
  it('defaults frequent to false and active to true', () => {
    expect(serviceItemInputSchema.parse(service)).toEqual({
      code: 'EXT',
      name: 'Extraction',
      category: 'Surgical',
      chargeUnit: 'per_tooth',
      price: '30',
      frequent: false,
      active: true,
    });
  });

  it('treats a blank category as none', () => {
    expect(serviceItemInputSchema.parse({ ...service, category: '  ' }).category).toBeNull();
  });

  it('requires a name and a known charge unit', () => {
    expect(serviceItemInputSchema.safeParse({ ...service, name: ' ' }).success).toBe(false);
    expect(serviceItemInputSchema.safeParse({ ...service, chargeUnit: 'per_visit' }).success).toBe(
      false,
    );
  });

  it('never accepts a currency from the client', () => {
    expect(serviceItemInputSchema.parse({ ...service, currency: 'EUR' })).not.toHaveProperty(
      'currency',
    );
  });
});

describe('serviceItemSchema', () => {
  it('carries the price as money', () => {
    const item = {
      id: ID_A,
      code: 'EXT',
      name: 'Extraction',
      category: null,
      chargeUnit: 'per_jaw',
      price: { amount: '30.00', currency: 'USD' },
      frequent: true,
      active: true,
    };
    expect(serviceItemSchema.parse(item)).toEqual(item);
  });
});

describe('catalog batches', () => {
  it('reject an empty batch', () => {
    expect(serviceBatchSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it('reject a row id sent twice, at the second row', () => {
    const result = serviceBatchSchema.safeParse({
      items: [
        { ...service, id: ID_A },
        { ...service, id: ID_B, code: 'CMP' },
        { ...service, id: ID_A, code: 'ZIR' },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['items', 2, 'id']);
  });

  it('accept new rows without ids next to existing ones', () => {
    const batch = diagnosisBatchSchema.parse({
      items: [
        { code: 'DX-CAR', name: 'Dental caries', category: 'Caries' },
        { id: ID_A, code: 'DX-GIN', name: 'Gingivitis', category: null, active: false },
      ],
    });
    expect(batch.items.map((item) => item.id)).toEqual([undefined, ID_A]);
    expect(diagnosisItemInputSchema.parse(batch.items[0]).frequent).toBe(false);
  });
});
