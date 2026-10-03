import type { PatientAccount } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { capOf, halfOf, initialDraft, requestOf, statusOf } from './payment-draft';

const id = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d${String(n).padStart(2, '0')}`;

const charge = (n: number, outstanding: string) => ({
  entryId: id(n),
  patientId: id(1),
  kind: 'visit_charge' as const,
  visitId: id(n + 50),
  visitNumber: n,
  date: '2026-09-01',
  charged: outstanding,
  paid: '0.00',
  outstanding,
});

const ACCOUNT: PatientAccount = {
  patientId: id(1),
  currency: 'USD',
  balance: '500.00',
  credit: '0.00',
  lastVisit: null,
  previousOutstanding: '500.00',
  openCharges: [charge(10, '200.00'), charge(11, '300.00')],
  payer: { contactId: id(2), name: 'Karim Haddad', patientId: null },
  payers: [{ contactId: id(2), name: 'Karim Haddad', patientId: null }],
  household: {
    payer: { contactId: id(2), name: 'Karim Haddad', patientId: null },
    patients: [],
    total: '650.00',
  },
  payerFor: null,
  history: [],
};

const draft = (patch: Partial<ReturnType<typeof initialDraft>> = {}) => ({
  ...initialDraft('2026-10-02'),
  ...patch,
});

describe('the Record payment draft (B2–B5)', () => {
  it('caps at what the patient owes, or the household with the default payer', () => {
    expect(capOf(draft(), ACCOUNT)).toBe(50000n);
    expect(capOf(draft({ household: true }), ACCOUNT)).toBe(65000n);
    // Another payer: the household no longer applies.
    expect(capOf(draft({ household: true, payerContactId: null }), ACCOUNT)).toBe(50000n);
  });

  it('starts empty, then reads partial, full, zero, over and unreadable amounts', () => {
    expect(statusOf(draft(), ACCOUNT, 'en')).toMatchObject({ amount: null, problem: null });
    expect(statusOf(draft({ amountText: '120.5' }), ACCOUNT, 'en')).toMatchObject({
      amount: 12050n,
      problem: null,
      remaining: 37950n,
      full: false,
    });
    expect(statusOf(draft({ amountText: '500' }), ACCOUNT, 'en')).toMatchObject({
      remaining: 0n,
      full: true,
    });
    expect(statusOf(draft({ amountText: '0' }), ACCOUNT, 'en').problem).toBe('zero');
    expect(statusOf(draft({ amountText: '500.01' }), ACCOUNT, 'en').problem).toBe('over');
    expect(statusOf(draft({ amountText: 'abc' }), ACCOUNT, 'en').problem).toBe('invalid');
    // A French decimal comma reads as a decimal.
    expect(statusOf(draft({ amountText: '12,50' }), ACCOUNT, 'fr').amount).toBe(1250n);
  });

  it('halves to the cent, rounding down', () => {
    expect(halfOf(50001n)).toBe('250.00');
  });

  it('builds the request: context visit, chosen charge, payer, trimmed reference', () => {
    expect(
      requestOf(
        draft({ targetEntryId: id(11), reference: '  POS 12 ', payerContactId: null }),
        ACCOUNT,
        30000n,
        { patientId: id(1), contextVisitId: id(60) },
      ),
    ).toEqual({
      patientId: id(1),
      amount: '300.00',
      method: 'cash',
      paidAt: '2026-10-02',
      scope: 'patient',
      reference: 'POS 12',
      payerContactId: null,
      contextVisitId: id(60),
      targetEntryId: id(11),
    });
  });

  it('pays the household without a chosen charge', () => {
    expect(
      requestOf(draft({ household: true, targetEntryId: id(11) }), ACCOUNT, 60000n, {
        patientId: id(1),
      }),
    ).toEqual({
      patientId: id(1),
      amount: '600.00',
      method: 'cash',
      paidAt: '2026-10-02',
      scope: 'household',
    });
  });

  it('pays for the payer the panel was opened for (a family), with the household preset', () => {
    expect(initialDraft('2026-10-02', undefined, true).household).toBe(true);
    expect(
      requestOf(draft({ household: true }), ACCOUNT, 60000n, {
        patientId: id(1),
        payerContactId: id(2),
      }),
    ).toMatchObject({ scope: 'household', payerContactId: id(2) });
  });
});
