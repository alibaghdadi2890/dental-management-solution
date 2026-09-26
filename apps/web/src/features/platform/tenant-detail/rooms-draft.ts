import type { Branch, BranchPatch, Room, RoomBatch } from '@dcm/contracts';

/** A room row being edited; `id` is absent until the room is saved. */
export interface DraftRoom {
  key: string;
  id?: string;
  branchId: string;
  name: string;
  code: string;
  active: boolean;
}

export interface BranchesDraft {
  rooms: DraftRoom[];
  /** Branch Active switches, by branch id. */
  branchActive: Record<string, boolean>;
}

export function draftFrom(branches: readonly Branch[], rooms: readonly Room[]): BranchesDraft {
  return {
    rooms: rooms.map((room) => ({
      key: room.id,
      id: room.id,
      branchId: room.branchId,
      name: room.name,
      code: room.code ?? '',
      active: room.active,
    })),
    branchActive: Object.fromEntries(branches.map((branch) => [branch.id, branch.active])),
  };
}

export function addRoom(draft: BranchesDraft, branchId: string, key: string): BranchesDraft {
  return {
    ...draft,
    rooms: [...draft.rooms, { key, branchId, name: '', code: '', active: true }],
  };
}

export function editRoom(
  draft: BranchesDraft,
  key: string,
  patch: Partial<Pick<DraftRoom, 'name' | 'code' | 'active'>>,
): BranchesDraft {
  return {
    ...draft,
    rooms: draft.rooms.map((room) => (room.key === key ? { ...room, ...patch } : room)),
  };
}

/** Delete in the UI: a new row disappears; a saved room is deactivated, never deleted (ADR-0007). */
export function removeRoom(draft: BranchesDraft, key: string): BranchesDraft {
  const room = draft.rooms.find((candidate) => candidate.key === key);
  if (room?.id === undefined) {
    return { ...draft, rooms: draft.rooms.filter((candidate) => candidate.key !== key) };
  }
  return editRoom(draft, key, { active: false });
}

export function setBranchActive(
  draft: BranchesDraft,
  branchId: string,
  active: boolean,
): BranchesDraft {
  return { ...draft, branchActive: { ...draft.branchActive, [branchId]: active } };
}

export function isRoomChanged(original: BranchesDraft, room: DraftRoom): boolean {
  if (room.id === undefined) return true;
  const saved = original.rooms.find((candidate) => candidate.id === room.id);
  return (
    saved === undefined ||
    saved.name !== room.name ||
    saved.code !== room.code ||
    saved.active !== room.active
  );
}

export interface DraftChanges {
  count: number;
  /** Rows missing a name block saving (Catalog rule). */
  missingNames: boolean;
  branches: { id: string; patch: BranchPatch }[];
  rooms: RoomBatch['items'];
}

export function changesOf(original: BranchesDraft, draft: BranchesDraft): DraftChanges {
  const rooms = draft.rooms.filter((room) => isRoomChanged(original, room));
  const branches = Object.entries(draft.branchActive)
    .filter(([id, active]) => original.branchActive[id] !== active)
    .map(([id, active]) => ({ id, patch: { active } }));
  return {
    count: rooms.length + branches.length,
    missingNames: rooms.some((room) => room.name.trim() === ''),
    branches,
    rooms: rooms.map((room) => ({
      ...(room.id === undefined ? {} : { id: room.id }),
      branchId: room.branchId,
      name: room.name.trim(),
      code: room.code.trim() || null,
      active: room.active,
    })),
  };
}
