import { describe, expect, it } from 'vitest';
import { RoomCodeTakenError, RoomNameTakenError } from './tenancy-errors';
import { assertUniqueRooms, type RoomIdentity } from './room-batch';

const room = (
  id: string,
  name: string,
  code: string | null = null,
  branchId = 'b1',
): RoomIdentity => ({
  id,
  branchId,
  name,
  code,
});

describe('assertUniqueRooms', () => {
  it('accepts distinct names and codes per branch, and repeats across branches', () => {
    expect(() => {
      assertUniqueRooms(
        [room('r1', 'Room 1', 'R1'), room('r2', 'Room 1', 'R1', 'b2')],
        [room('r3', 'Room 2', 'R2')],
      );
    }).not.toThrow();
  });

  it('compares names case-insensitively after applying the changes', () => {
    expect(() => {
      assertUniqueRooms([room('r1', 'Room 1')], [room('r2', 'room 1')]);
    }).toThrow(RoomNameTakenError);
  });

  it('lets two rooms swap names in one batch', () => {
    expect(() => {
      assertUniqueRooms(
        [room('r1', 'Room A'), room('r2', 'Room B')],
        [room('r1', 'Room B'), room('r2', 'Room A')],
      );
    }).not.toThrow();
  });

  it('rejects duplicate codes but allows several rooms without a code', () => {
    expect(() => {
      assertUniqueRooms([room('r1', 'Room 1', 'x1')], [room('r2', 'Room 2', 'X1')]);
    }).toThrow(RoomCodeTakenError);
    expect(() => {
      assertUniqueRooms([room('r1', 'Room 1')], [room('r2', 'Room 2')]);
    }).not.toThrow();
  });
});
