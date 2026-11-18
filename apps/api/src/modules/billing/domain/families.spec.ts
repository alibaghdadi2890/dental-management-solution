import { describe, expect, it } from 'vitest';
import { familyKeyOf, payerOf } from './families';

const contact = (id: string, linkedPatientId: string | null = null, archived = false) => ({
  id,
  fullName: `Contact ${id}`,
  linkedPatient: linkedPatientId === null ? null : { id: linkedPatientId, archived },
});

describe('familyKeyOf', () => {
  it('groups patients under their primary billing contact; a patient without one is alone', () => {
    const mother = contact('c-mother');
    const keyOf = familyKeyOf(
      new Map([
        ['p-lina', mother],
        ['p-omar', mother],
      ]),
    );
    expect(keyOf('p-lina')).toBe('c-mother');
    expect(keyOf('p-omar')).toBe('c-mother');
    expect(keyOf('p-sami')).toBe('p-sami');
  });

  it('puts a payer who is a patient in the family they pay for', () => {
    const father = contact('c-father', 'p-father');
    const keyOf = familyKeyOf(new Map([['p-lina', father]]));
    expect(keyOf('p-father')).toBe('c-father');
  });

  it('keeps a payer who is billed by someone else in that family instead', () => {
    const father = contact('c-father', 'p-father');
    const grandma = contact('c-grandma');
    const keyOf = familyKeyOf(
      new Map([
        ['p-lina', father],
        ['p-father', grandma],
      ]),
    );
    expect(keyOf('p-father')).toBe('c-grandma');
    expect(keyOf('p-lina')).toBe('c-father');
  });
});

describe('payerOf', () => {
  it('names the contact, with their patient record unless it is archived', () => {
    expect(payerOf(contact('c-father', 'p-father'))).toEqual({
      contactId: 'c-father',
      name: 'Contact c-father',
      patientId: 'p-father',
    });
    expect(payerOf(contact('c-father', 'p-father', true)).patientId).toBeNull();
    expect(payerOf(contact('c-mother')).patientId).toBeNull();
  });
});
