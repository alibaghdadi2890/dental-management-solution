import type { Room } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { isUniqueViolation } from '../../../platform/db/unique-violation';
import { RoomCodeTakenError, RoomNameTakenError } from '../domain/tenancy-errors';
import { rooms } from './schema';

type RoomRow = typeof rooms.$inferSelect;

function toRoom(row: RoomRow): Room {
  return { id: row.id, branchId: row.branchId, name: row.name, code: row.code, active: row.active };
}

/** Rooms of the current tenant (RLS). */
@Injectable()
export class RoomsRepository {
  constructor(private readonly db: TenantDb) {}

  list(branchId?: string): Promise<Room[]> {
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(rooms)
          .where(branchId === undefined ? undefined : eq(rooms.branchId, branchId))
          .orderBy(asc(rooms.createdAt), asc(rooms.id))
      ).map(toRoom),
    );
  }

  /**
   * Inserts or updates rooms by id inside the caller's transaction. Updated rooms first move to a
   * placeholder name so a batch can swap names or codes: unique indexes are checked per statement.
   */
  async save(items: readonly Room[], existingIds: ReadonlySet<string>): Promise<void> {
    const updates = items.filter((room) => existingIds.has(room.id));
    const inserts = items.filter((room) => !existingIds.has(room.id));
    try {
      await this.db.run(async (tx) => {
        for (const room of updates) {
          await tx
            .update(rooms)
            .set({ name: `~renaming~${room.id}`, code: null })
            .where(eq(rooms.id, room.id));
        }
        for (const room of updates) {
          await tx
            .update(rooms)
            .set({ name: room.name, code: room.code, active: room.active })
            .where(eq(rooms.id, room.id));
        }
        if (inserts.length > 0) {
          await tx.insert(rooms).values(inserts);
        }
      });
    } catch (error) {
      if (isUniqueViolation(error, 'rooms_name_unique')) {
        throw new RoomNameTakenError('A room with this name already exists in this branch');
      }
      if (isUniqueViolation(error, 'rooms_code_unique')) {
        throw new RoomCodeTakenError('A room with this code already exists in this branch');
      }
      throw error;
    }
  }
}
