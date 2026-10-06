import { describe, expect, it } from 'vitest';
import {
  addServiceSchema,
  liveVisitQuerySchema,
  liveVisitRefSchema,
  serviceResultSchema,
  updateServiceSchema,
  visitDiscountSchema,
  visitNotesSchema,
  visitResultSchema,
  visitSchema,
} from './visits.js';

const ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';
const ID_2 = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f';

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

const VISIT = {
  id: ID,
  displayNumber: 12,
  patientId: ID,
  branchId: ID,
  roomId: ID_2,
  dentistId: ID,
  startedBy: ID,
  status: 'in_progress',
  localDate: '2026-09-29',
  startedAt: '2026-09-29T10:00:00Z',
  pausedAt: null,
  pausedSeconds: 0,
  completedAt: null,
  completedBy: null,
  unfinishedAnsweredAt: null,
  durationMinutes: null,
  notes: 'Patient reports sensitivity on #16.',
  discountMode: 'percent',
  discountValue: '10',
  currency: 'USD',
  services: [
    {
      id: ID,
      procedureId: ID,
      code: 'CMP',
      name: 'Composite filling',
      category: 'Restorative',
      chargeUnit: 'per_tooth',
      toothCode: '16',
      jaw: null,
      surfaces: ['O'],
      base: { amount: '45.00', currency: 'USD' },
      discount: { amount: '0.00', currency: 'USD' },
      final: { amount: '45.00', currency: 'USD' },
      planId: null,
      recordedBy: ID,
      createdAt: '2026-09-29T10:05:00Z',
    },
  ],
  money: { subtotal: '45.00', discount: '4.50', total: '40.50', capped: false },
  voidedAt: null,
  voidReason: null,
  updatedAt: '2026-09-29T10:05:00Z',
  serverNow: '2026-09-29T10:10:00Z',
};

const [SERVICE] = VISIT.services;

describe('visitSchema', () => {
  it('round-trips a representative live visit', () => {
    const result = visitSchema.safeParse(VISIT);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(VISIT);
  });
});

describe('visit route results', () => {
  it('wraps the visit, and the service for the service routes', () => {
    expect(visitResultSchema.safeParse({ visit: VISIT }).success).toBe(true);
    expect(serviceResultSchema.safeParse({ visit: VISIT, record: SERVICE }).success).toBe(true);
  });

  it('rejects a bare visit and a service result without its record', () => {
    expect(visitResultSchema.safeParse(VISIT).success).toBe(false);
    expect(serviceResultSchema.safeParse({ visit: VISIT }).success).toBe(false);
  });
});

describe('liveVisitRefSchema', () => {
  const ref = {
    id: ID,
    patientId: ID_2,
    patientName: 'Nadia Haddad',
    dentistName: 'Dr. Ana Reyes',
    status: 'paused',
    startedAt: '2026-09-29T10:00:00Z',
    pausedAt: '2026-09-29T10:20:00Z',
    pausedSeconds: 30,
    serverNow: '2026-09-29T10:25:00Z',
  };

  it('carries serverNow so the pill can run its timer', () => {
    expect(liveVisitRefSchema.safeParse(ref).success).toBe(true);
    const { serverNow: _omitted, ...withoutServerNow } = ref;
    expect(liveVisitRefSchema.safeParse(withoutServerNow).success).toBe(false);
  });
});
