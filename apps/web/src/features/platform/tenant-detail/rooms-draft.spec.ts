import type { Branch, Room } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import {
  addRoom,
  changesOf,
  draftFrom,
  editRoom,
  isRoomChanged,
  removeRoom,
  setBranchActive,
} from './rooms-draft';

const branch = (id: string): Branch => ({
  id,
  name: `Branch ${id}`,
  code: null,
  address: null,
  phone: null,
  active: true,
  createdAt: '2026-09-26T10:00:00.000Z',
});
const room = (id: string, name: string, code: string | null = null): Room => ({
  id,
  branchId: 'b1',
  name,
  code,
  active: true,
});

const original = draftFrom([branch('b1')], [room('r1', 'Room 1', 'R1'), room('r2', 'Room 2')]);

describe('rooms draft (Catalog-style editing)', () => {
  it('starts with no changes', () => {
    expect(changesOf(original, original)).toMatchObject({ count: 0, missingNames: false });
  });

  it('counts edited rows and sends only them, with blank codes as null', () => {
    const draft = editRoom(original, 'r1', { name: 'Room 1A', code: ' ' });
    expect(isRoomChanged(original, draft.rooms[0]!)).toBe(true);
    expect(isRoomChanged(original, draft.rooms[1]!)).toBe(false);
    expect(changesOf(original, draft)).toMatchObject({
      count: 1,
      rooms: [{ id: 'r1', branchId: 'b1', name: 'Room 1A', code: null, active: true }],
    });
  });

  it('reverting an edit clears the change', () => {
    const edited = editRoom(original, 'r2', { name: 'Other' });
    const reverted = editRoom(edited, 'r2', { name: 'Room 2' });
    expect(changesOf(original, reverted).count).toBe(0);
  });

  it('adds new rooms without an id and blocks saving until they are named', () => {
    const draft = addRoom(original, 'b1', 'new-1');
    expect(changesOf(original, draft)).toMatchObject({ count: 1, missingNames: true });
    const named = editRoom(draft, 'new-1', { name: 'Room 3' });
    expect(changesOf(original, named)).toMatchObject({
      missingNames: false,
      rooms: [{ branchId: 'b1', name: 'Room 3', code: null, active: true }],
    });
  });

  it('deactivates saved rooms and drops unsaved ones on delete', () => {
    const withNew = addRoom(original, 'b1', 'new-1');
    const afterDelete = removeRoom(removeRoom(withNew, 'new-1'), 'r2');
    expect(afterDelete.rooms.map((row) => row.key)).toEqual(['r1', 'r2']);
    expect(changesOf(original, afterDelete).rooms).toEqual([
      { id: 'r2', branchId: 'b1', name: 'Room 2', code: null, active: false },
    ]);
  });

  it('tracks branch Active switches as changes', () => {
    const draft = setBranchActive(original, 'b1', false);
    expect(changesOf(original, draft)).toMatchObject({
      count: 1,
      branches: [{ id: 'b1', patch: { active: false } }],
    });
  });
});
