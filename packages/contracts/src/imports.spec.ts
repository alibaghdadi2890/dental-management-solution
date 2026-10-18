import { describe, expect, it } from 'vitest';
import {
  IMPORT_ROWS_MAX,
  importPatientRowSchema,
  importPatientsRequestSchema,
  importServiceRowSchema,
  importVisitRowSchema,
} from './imports.js';

const ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';

describe('importPatientRowSchema', () => {
  it('defaults a sparse row: unknown sex, active, no allergies, no balance', () => {
    const row = importPatientRowSchema.parse({
      externalId: ' PAT-00002 ',
      fullName: 'Maya Nasser',
    });
    expect(row).toMatchObject({
      externalId: 'PAT-00002',
      sex: 'unknown',
      dateOfBirth: null,
      phone: null,
      status: 'active',
      allergies: [],
      openingBalance: null,
    });
  });

  it('takes an opening balance above zero only', () => {
    const base = { externalId: 'PAT-1', fullName: 'A' };
    expect(
      importPatientRowSchema.safeParse({
        ...base,
        openingBalance: { amount: '0', asOf: '2026-10-01' },
      }).success,
    ).toBe(false);
    expect(
      importPatientRowSchema.parse({
        ...base,
        openingBalance: { amount: '140', asOf: '2026-10-01' },
      }).openingBalance,
    ).toMatchObject({ amount: '140', asOf: '2026-10-01' });
  });
});

describe('import requests', () => {
  it(`take 1 to ${String(IMPORT_ROWS_MAX)} rows and default to a real run`, () => {
    const row = { externalId: 'PAT-1', fullName: 'A' };
    expect(importPatientsRequestSchema.parse({ rows: [row] }).dryRun).toBe(false);
    expect(importPatientsRequestSchema.safeParse({ rows: [] }).success).toBe(false);
    expect(
      importPatientsRequestSchema.safeParse({ rows: Array(IMPORT_ROWS_MAX + 1).fill(row) }).success,
    ).toBe(false);
  });
});

describe('importServiceRowSchema', () => {
  it('is a new catalog row: an id is refused', () => {
    const row = { code: 'pulpot', name: 'Pulpotomy', chargeUnit: 'per_tooth', price: '75' };
    expect(importServiceRowSchema.parse(row).code).toBe('PULPOT');
    expect(importServiceRowSchema.safeParse({ ...row, id: ID }).success).toBe(false);
  });
});

describe('importVisitRowSchema', () => {
  const visit = {
    externalId: 'VIS-00002',
    patientExternalId: 'PAT-00005',
    branchId: ID,
    dentistId: ID,
    date: '2026-01-02',
  };

  it('defaults a line to done at no charge, and takes FDI teeth and HH:MM times only', () => {
    const row = importVisitRowSchema.parse({
      ...visit,
      startTime: '12:53',
      lines: [{ serviceCode: 'CMP', tooth: '36' }],
    });
    expect(row.lines).toEqual([
      { serviceCode: 'CMP', tooth: '36', jaw: null, amount: '0', done: true },
    ]);
    expect(row.roomId).toBeNull();
    expect(importVisitRowSchema.parse({ ...visit, notes: 'x', roomId: '' }).roomId).toBeNull();
    expect(
      importVisitRowSchema.safeParse({ ...visit, lines: [{ serviceCode: 'CMP', tooth: '19' }] })
        .success,
    ).toBe(false);
    expect(
      importVisitRowSchema.safeParse({ ...visit, notes: 'x', startTime: '25:00' }).success,
    ).toBe(false);
  });

  it('needs a service or a note', () => {
    expect(importVisitRowSchema.safeParse(visit).success).toBe(false);
    expect(importVisitRowSchema.safeParse({ ...visit, notes: 'tooth 36: GIC' }).success).toBe(true);
  });
});
