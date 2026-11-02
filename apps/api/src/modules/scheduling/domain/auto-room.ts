/** A room of the branch, active, in the order the branch lists them. */
export interface RoomRef {
  id: string;
  name: string;
}

export interface AutoRoom {
  room: RoomRef | null;
  usualRoom: RoomRef | null;
  isUsual: boolean;
}

/**
 * *Auto* (the design's room rule): the dentist's usual room when free, else the first free room,
 * else none; "Room assigned at check-in". A usual room that left the branch is no usual room.
 */
export function chooseRoom(
  rooms: readonly RoomRef[],
  usualRoomId: string | null,
  isFree: (roomId: string) => boolean,
): AutoRoom {
  const usualRoom = rooms.find((room) => room.id === usualRoomId) ?? null;
  if (usualRoom && isFree(usualRoom.id)) {
    return { room: usualRoom, usualRoom, isUsual: true };
  }
  return { room: rooms.find((room) => isFree(room.id)) ?? null, usualRoom, isUsual: false };
}
