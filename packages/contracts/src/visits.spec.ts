import { describe, expect, it } from 'vitest';
import {
  addServiceSchema,
  liveVisitQuerySchema,
  updateServiceSchema,
  visitDiscountSchema,
  visitNotesSchema,
} from './visits.js';

describe('addServiceSchema', () => {
  it('accepts a per-tooth service with surfaces', () => {
    const result = addServiceSchema.safeParse({
      procedureId: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e',
      toothCode: '16',
      surfaces: ['M', 'O'],
    });
    expect(result.success).toBe(true);
  });

  it('defaults surfaces to empty', () => {
    const result = addServiceSchema.parse({
      procedureId: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e',
    });
    expect(result.surfaces).toEqual([]);
  });

  it('rejects an unknown tooth code', () => {
    const result = addServiceSchema.safeParse({
      procedureId: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e',
      toothCode: '99',
      surfaces: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate surfaces', () => {
    const result = addServiceSchema.safeParse({
      procedureId: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e',
      toothCode: '16',
      surfaces: ['M', 'M'],
    });
    expect(result.success).toBe(false);
  });
});

describe('updateServiceSchema', () => {
  it('accepts either field alone', () => {
    expect(updateServiceSchema.safeParse({ baseAmount: '30.00' }).success).toBe(true);
    expect(updateServiceSchema.safeParse({ discountAmount: '5.00' }).success).toBe(true);
  });

  it('requires at least one field', () => {
    expect(updateServiceSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a negative amount', () => {
    expect(updateServiceSchema.safeParse({ baseAmount: '-1.00' }).success).toBe(false);
  });
});

describe('visitNotesSchema', () => {
  it('accepts up to 20,000 characters', () => {
    expect(visitNotesSchema.safeParse({ notes: 'a'.repeat(20000) }).success).toBe(true);
    expect(visitNotesSchema.safeParse({ notes: 'a'.repeat(20001) }).success).toBe(false);
  });

  it('accepts an empty string', () => {
    expect(visitNotesSchema.safeParse({ notes: '' }).success).toBe(true);
  });
});

describe('visitDiscountSchema', () => {
  it('accepts a percent or amount mode with a non-negative value', () => {
    expect(visitDiscountSchema.safeParse({ mode: 'percent', value: '10' }).success).toBe(true);
    expect(visitDiscountSchema.safeParse({ mode: 'amount', value: '0' }).success).toBe(true);
  });

  it('rejects an unknown mode or a negative value', () => {
    expect(visitDiscountSchema.safeParse({ mode: 'fixed', value: '10' }).success).toBe(false);
    expect(visitDiscountSchema.safeParse({ mode: 'percent', value: '-10' }).success).toBe(false);
  });
});

describe('liveVisitQuerySchema', () => {
  it('treats a blank patientId and mine as absent', () => {
    const result = liveVisitQuerySchema.parse({ patientId: '', mine: '' });
    expect(result).toEqual({ patientId: undefined, mine: undefined });
  });

  it('parses mine=true and mine=false', () => {
    expect(liveVisitQuerySchema.parse({ mine: 'true' }).mine).toBe(true);
    expect(liveVisitQuerySchema.parse({ mine: 'false' }).mine).toBe(false);
  });
});
