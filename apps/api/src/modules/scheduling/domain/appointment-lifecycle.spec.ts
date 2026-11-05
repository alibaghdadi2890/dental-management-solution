import { APPOINTMENT_STATUSES, type AppointmentStatus } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, isUnresolved } from './appointment-lifecycle';
import { InvalidAppointmentTransitionError } from './scheduling-errors';

const LEGAL: readonly (readonly [AppointmentStatus, AppointmentStatus])[] = [
  ['booked', 'confirmed'],
  ['booked', 'checked_in'],
  ['booked', 'in_room'],
  ['booked', 'cancelled'],
  ['booked', 'no_show'],
  ['booked', 'rescheduled'],
  ['confirmed', 'checked_in'],
  ['confirmed', 'in_room'],
  ['confirmed', 'cancelled'],
  ['confirmed', 'no_show'],
  ['confirmed', 'rescheduled'],
  ['checked_in', 'confirmed'],
  ['checked_in', 'in_room'],
  ['in_room', 'checked_in'],
  ['in_room', 'completed'],
  ['cancelled', 'booked'],
  ['cancelled', 'confirmed'],
];

describe('appointment lifecycle', () => {
  const isLegal = (from: AppointmentStatus, to: AppointmentStatus) =>
    LEGAL.some(([legalFrom, legalTo]) => legalFrom === from && legalTo === to);

  for (const from of APPOINTMENT_STATUSES) {
    for (const to of APPOINTMENT_STATUSES) {
      it(`${from} → ${to} is ${isLegal(from, to) ? 'legal' : 'refused'}`, () => {
        expect(canTransition(from, to)).toBe(isLegal(from, to));
        if (isLegal(from, to)) {
          expect(() => {
            assertTransition(from, to);
          }).not.toThrow();
        } else {
          expect(() => {
            assertTransition(from, to);
          }).toThrow(InvalidAppointmentTransitionError);
        }
      });
    }
  }

  it('is unresolved only while waiting and past its end', () => {
    const end = new Date('2026-10-30T09:00:00Z');
    const after = new Date('2026-10-30T09:15:00Z');
    expect(isUnresolved('booked', end, after)).toBe(true);
    expect(isUnresolved('confirmed', end, after)).toBe(true);
    expect(isUnresolved('confirmed', end, new Date('2026-10-30T08:59:00Z'))).toBe(false);
    expect(isUnresolved('confirmed', end, end)).toBe(false);
    expect(isUnresolved('checked_in', end, after)).toBe(false);
    expect(isUnresolved('no_show', end, after)).toBe(false);
  });
});
