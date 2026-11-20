import { describe, expect, it } from 'vitest';
import { EMPTY_WISHES, wishesInput, wishesState, wishesValid } from './wishes-state';

describe('the wishes as the fields hold them (A2)', () => {
  it('sends blank fields as not set, and both times or neither', () => {
    expect(wishesInput({ ...EMPTY_WISHES, weekdays: [1, 2, 3], note: '  ' })).toEqual({
      weekdays: [1, 2, 3],
      betweenFrom: null,
      betweenTo: null,
      notBefore: null,
      sameDay: false,
      urgent: false,
      note: null,
    });
    expect(wishesInput({ ...EMPTY_WISHES, betweenFrom: '14:00' })).toMatchObject({
      betweenFrom: null,
      betweenTo: null,
    });
    expect(
      wishesInput({
        ...EMPTY_WISHES,
        betweenFrom: '14:00',
        betweenTo: '18:00',
        notBefore: '2026-12-01',
      }),
    ).toMatchObject({ betweenFrom: '14:00', betweenTo: '18:00', notBefore: '2026-12-01' });
  });

  it('refuses one time alone or a latest before the earliest', () => {
    expect(wishesValid(EMPTY_WISHES)).toBe(true);
    expect(wishesValid({ ...EMPTY_WISHES, betweenFrom: '14:00' })).toBe(false);
    expect(wishesValid({ ...EMPTY_WISHES, betweenFrom: '18:00', betweenTo: '14:00' })).toBe(false);
    expect(wishesValid({ ...EMPTY_WISHES, betweenFrom: '14:00', betweenTo: '18:00' })).toBe(true);
  });

  it('reads stored wishes back into the fields', () => {
    expect(
      wishesState(
        { weekdays: [6], betweenFrom: null, betweenTo: null, notBefore: null, sameDay: true },
        { urgent: true, note: null },
      ),
    ).toEqual({ ...EMPTY_WISHES, weekdays: [6], sameDay: true, urgent: true });
  });
});
