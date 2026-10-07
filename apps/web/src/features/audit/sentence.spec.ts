import type { AuditEntry } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import en from '@/locales/en/activity.json';
import { type Lookups, readableAction, sentenceOf } from './sentence';

const id = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d${String(n).padStart(2, '0')}`;
const PATIENT = id(1);
const VISIT = id(2);
const STAFF = id(3);

const lookups: Lookups = {
  patients: new Map([
    [PATIENT, { id: PATIENT, fullName: 'Rami Khoury', displayNumber: 'P-000012' }],
  ]),
  visits: new Map([[VISIT, { visitId: VISIT, displayNumber: 45, localDate: '2026-10-01' }]]),
  staff: new Map([[STAFF, 'Lina S.']]),
  money: (amount, currency) => `${currency} ${amount}`,
  tooth: (code) => `#${code}`,
  label: (group, value) => (group === 'method' && value === 'cash' ? 'cash' : value),
};

const entry = (patch: Partial<AuditEntry>): AuditEntry => ({
  id: id(9),
  actorUserId: STAFF,
  actorKind: 'user',
  actorPlatformAdmin: false,
  action: 'patient.update',
  resourceType: 'patient',
  resourceId: PATIENT,
  before: null,
  after: null,
  reason: null,
  requestId: null,
  occurredAt: '2026-10-01T07:05:00.000Z',
  patientId: null,
  visitId: null,
  area: null,
  ...patch,
});

/** The English sentence, with the subject written in brackets where the link goes. */
function read(patch: Partial<AuditEntry>): string {
  const sentence = sentenceOf(entry(patch), lookups);
  const template = sentence.key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      en.actions,
    );
  if (typeof template !== 'string') throw new Error(`no sentence for ${sentence.key}`);
  const filled = template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    name === 'subject'
      ? sentence.subject
        ? `[${sentence.subject.label}]`
        : ''
      : (sentence.values[name] ?? ''),
  );
  return sentence.about ? `${filled.trim()} · ${sentence.about.label}` : filled.trim();
}

describe('sentenceOf (H7)', () => {
  it('names a visit by its number and says whose it is', () => {
    expect(
      read({
        action: 'visit.void',
        resourceType: 'visit',
        resourceId: VISIT,
        visitId: VISIT,
        patientId: PATIENT,
      }),
    ).toBe('Voided visit [V-000045] · Rami Khoury');
    expect(
      read({
        action: 'visit.update',
        resourceType: 'visit',
        resourceId: VISIT,
        visitId: VISIT,
        after: { notes: 'x' },
      }),
    ).toBe('Edited the notes of visit [V-000045]');
  });

  it('reads a payment with its receipt, amount and method, linking the receipt', () => {
    const sentence = sentenceOf(
      entry({
        action: 'payment.create',
        resourceType: 'payment',
        resourceId: id(30),
        patientId: PATIENT,
        after: { receiptNumber: 12, amount: '150.00', currency: 'USD', method: 'cash' },
      }),
      lookups,
    );
    expect(sentence).toMatchObject({
      key: 'payment.create',
      subject: { kind: 'receipt', paymentId: id(30), label: 'RCT-000012' },
      values: { amount: 'USD 150.00', method: 'cash' },
      about: { kind: 'patient', id: PATIENT },
    });
  });

  it('names a patient from the lookup, or from the snapshot when the lookup has none', () => {
    expect(read({ action: 'patient.archive', patientId: PATIENT })).toBe(
      'Archived patient [Rami Khoury]',
    );
    expect(
      read({ action: 'patient.create', patientId: id(77), after: { fullName: 'New Person' } }),
    ).toBe('Registered patient [New Person]');
  });

  it('tells a catalog price change from another edit', () => {
    const base = {
      code: 'EXT-01',
      name: 'Extraction',
      price: { amount: '40.00', currency: 'USD' },
    };
    expect(
      read({
        action: 'catalog.service.update',
        resourceType: 'procedure',
        before: base,
        after: { ...base, price: { amount: '45.00', currency: 'USD' } },
      }),
    ).toBe('Changed catalog service [EXT-01] price');
    expect(
      read({
        action: 'catalog.service.update',
        resourceType: 'procedure',
        before: base,
        after: { ...base, name: 'Simple extraction' },
      }),
    ).toBe('Edited catalog service [EXT-01]');
  });

  it('names a user from the snapshot or the staff list, and a service with its tooth', () => {
    expect(
      read({
        action: 'user.deactivate',
        resourceType: 'user',
        resourceId: STAFF,
        after: { active: false },
      }),
    ).toBe('Deactivated user [Lina S.]');
    expect(
      read({
        action: 'visit_service.create',
        resourceType: 'visit_service',
        visitId: VISIT,
        patientId: PATIENT,
        after: { code: 'EXT', name: 'Extraction', toothCode: '46' },
      }),
    ).toBe('Added Extraction (EXT) · #46 to visit [V-000045] · Rami Khoury');
  });

  it('words an adjustment by its direction', () => {
    const adjustment = (amount: string) =>
      read({
        action: 'ledger_entry.create',
        resourceType: 'ledger_entry',
        patientId: PATIENT,
        after: { kind: 'adjustment', amount, currency: 'USD' },
      });
    expect(adjustment('-20.00')).toBe('Reduced the balance of [Rami Khoury] by USD 20.00');
    expect(adjustment('35.00')).toBe('Added USD 35.00 to the balance of [Rami Khoury]');
  });

  it('falls back to a readable version of an action nobody wrote a sentence for', () => {
    expect(readableAction('treatment_plan.some_new_thing')).toBe('Treatment plan · some new thing');
    expect(read({ action: 'widget.rotate', resourceType: 'widget', patientId: PATIENT })).toBe(
      'Widget · rotate [Rami Khoury]',
    );
  });
});

describe('every action the API emits has a sentence (H7)', () => {
  // The actions `audit.record` is called with today (docs/modules/audit.md, Vocabulary).
  const EMITTED = [
    'patient.create',
    'patient.update',
    'patient.dentition',
    'patient.archive',
    'patient.restore',
    'patient.merge',
    'contact.link',
    'contact.roles',
    'contact.unlink',
    'contact.merge',
    'contact.update',
    'visit.start',
    'visit.pause',
    'visit.resume',
    'visit.update',
    'visit.discard',
    'visit.complete',
    'visit.amend',
    'visit.discount',
    'visit.checkout',
    'visit.void',
    'visit.unfinished_answered',
    'visit_service.create',
    'visit_service.update',
    'visit_service.delete',
    'visit_service.unfinished',
    'diagnosis_record.create',
    'diagnosis_record.delete',
    'diagnosis_record.resolve',
    'diagnosis_record.reopen',
    'treatment_plan.create',
    'treatment_plan.update',
    'treatment_plan.start',
    'treatment_plan.cancel',
    'treatment_plan.perform',
    'treatment_plan.unperform',
    'treatment_plan.session',
    'treatment_plan.session_delete',
    'treatment_plan.reprice',
    'treatment_plan.delete',
    'plan_group.create',
    'plan_group.update',
    'plan_group.delete',
    'tooth_presence.set',
    'tooth_presence.remove',
    'clinical.repoint',
    'ledger_entry.create',
    'ledger_entry.repoint',
    'payment.create',
    'payment.refund',
    'payment.void',
    'catalog.service.create',
    'catalog.service.update',
    'catalog.service.deactivate',
    'catalog.service.delete',
    'catalog.diagnosis.create',
    'catalog.diagnosis.update',
    'catalog.diagnosis.deactivate',
    'catalog.diagnosis.delete',
    'user.create',
    'user.update',
    'user.deactivate',
    'user.reactivate',
    'user.reset_password',
    'user.password_change',
    'user.roles_assign',
    'role.create',
    'tenant.provision',
    'tenant.update',
    'tenant.suspend',
    'tenant.reactivate',
    'branch.create',
    'branch.update',
    'room.create',
    'room.update',
  ];

  it.each(EMITTED)('%s', (action) => {
    const sentence = sentenceOf(
      entry({
        action,
        patientId: PATIENT,
        visitId: VISIT,
        after: { kind: 'adjustment', amount: '1.00' },
      }),
      lookups,
    );
    expect(sentence.key).not.toBe('fallback');
    const template = sentence.key
      .split('.')
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        en.actions,
      );
    expect(typeof template, sentence.key).toBe('string');
  });
});
