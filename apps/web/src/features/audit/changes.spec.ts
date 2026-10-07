import type { AuditEntry } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import en from '@/locales/en/activity.json';
import { CHANGE_FIELDS, type ChangeWords, changesOf } from './changes';

const words: ChangeWords = {
  empty: '—',
  yes: 'Yes',
  no: 'No',
  money: (amount, currency) => `${currency} ${amount}`,
};

const entry = (before: unknown, after: unknown): AuditEntry => ({
  id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d01',
  actorUserId: null,
  actorKind: 'user',
  actorPlatformAdmin: false,
  action: 'x.update',
  resourceType: 'x',
  resourceId: 'x',
  before,
  after,
  reason: null,
  requestId: null,
  occurredAt: '2026-10-01T07:05:00.000Z',
  patientId: null,
  visitId: null,
  area: null,
});

describe('changesOf (H7)', () => {
  it('lists only the labelled fields whose value differs, as before → after', () => {
    expect(
      changesOf(
        entry(
          { id: 'a', fullName: 'Rami Khoury', phone: '+961 3 123 456', updatedAt: 't1' },
          { id: 'a', fullName: 'Rami Khoury', phone: '+961 3 654 321', updatedAt: 't2' },
        ),
        'USD',
        words,
      ),
    ).toEqual([{ field: 'phone', before: '+961 3 123 456', after: '+961 3 654 321' }]);
  });

  it('formats money, prices, discounts, yes/no, lists and stored words', () => {
    const changes = changesOf(
      entry(
        {
          price: { amount: '40.00', currency: 'USD' },
          total: '100.00',
          discount: { mode: 'percent', value: '0' },
          active: true,
          medicalAlerts: [],
          status: 'in_progress',
          notes: null,
        },
        {
          price: { amount: '45.00', currency: 'USD' },
          total: '90.00',
          currency: 'EUR',
          discount: { mode: 'amount', value: '10.00' },
          active: false,
          medicalAlerts: ['Latex', 'Penicillin allergy'],
          status: 'completed',
          notes: 'Came in pain',
        },
      ),
      'USD',
      words,
    );
    expect(Object.fromEntries(changes.map((change) => [change.field, change]))).toMatchObject({
      price: { before: 'USD 40.00', after: 'USD 45.00' },
      // The entry's own currency when it has one, else the clinic's.
      total: { before: 'USD 100.00', after: 'EUR 90.00' },
      discount: { before: '0%', after: 'EUR 10.00' },
      active: { before: 'Yes', after: 'No' },
      medicalAlerts: { before: '—', after: 'Latex, Penicillin allergy' },
      status: { before: 'in progress', after: 'completed' },
      notes: { before: '—', after: 'Came in pain' },
    });
  });

  it('reads a create as nothing → value, and has nothing to show without labelled fields', () => {
    expect(changesOf(entry(null, { code: 'EXT', name: 'Extraction' }), 'USD', words)).toEqual([
      { field: 'name', before: '—', after: 'Extraction' },
      { field: 'code', before: '—', after: 'EXT' },
    ]);
    expect(changesOf(entry({ deletedAt: null }, { deletedAt: 'now' }), 'USD', words)).toEqual([]);
    expect(changesOf(entry(null, ['raw', 'json']), 'USD', words)).toEqual([]);
  });

  it('has a label for every field it may show', () => {
    expect(Object.keys(en.fields).sort()).toEqual([...CHANGE_FIELDS].sort());
  });
});
