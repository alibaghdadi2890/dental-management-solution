import { RoomCodeTakenError, RoomNameTakenError } from './tenancy-errors';

export interface RoomIdentity {
  id: string;
  branchId: string;
  name: string;
  code: string | null;
}

/**
 * Room names and codes are unique per branch, case-insensitively. Checked on the state *after* a
 * batch is applied, so a batch may swap names between rooms. The database enforces the same rule.
 */
export function assertUniqueRooms(
  existing: readonly RoomIdentity[],
  changes: readonly RoomIdentity[],
): void {
  const byId = new Map(existing.map((room) => [room.id, room]));
  for (const change of changes) {
    byId.set(change.id, change);
  }
  const names = new Set<string>();
  const codes = new Set<string>();
  for (const room of byId.values()) {
    const nameKey = `${room.branchId}:${room.name.toLowerCase()}`;
    if (names.has(nameKey)) {
      throw new RoomNameTakenError(`A room named "${room.name}" already exists in this branch`);
    }
    names.add(nameKey);
    if (room.code !== null) {
      const codeKey = `${room.branchId}:${room.code.toLowerCase()}`;
      if (codes.has(codeKey)) {
        throw new RoomCodeTakenError(`Room code "${room.code}" is already used in this branch`);
      }
      codes.add(codeKey);
    }
  }
}
