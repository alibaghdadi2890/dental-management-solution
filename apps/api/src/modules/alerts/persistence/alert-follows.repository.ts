import { Injectable } from '@nestjs/common';
import { and, eq, notInArray } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { newId } from '../../../platform/kernel/id';
import { alertFollows } from './schema';

@Injectable()
export class AlertFollowsRepository {
  constructor(private readonly db: TenantDb) {}

  /** The dentists (staff profile ids) this user follows. */
  async forUser(userId: string): Promise<string[]> {
    const rows = await this.db.run((tx) =>
      tx
        .select({ dentistId: alertFollows.dentistId })
        .from(alertFollows)
        .where(eq(alertFollows.userId, userId)),
    );
    return rows.map((row) => row.dentistId);
  }

  /** Makes `dentistIds` the user's whole set: the others are deleted (a junction). */
  async replace(userId: string, dentistIds: readonly string[]): Promise<void> {
    await this.db.run(async (tx) => {
      await tx
        .delete(alertFollows)
        .where(
          and(
            eq(alertFollows.userId, userId),
            dentistIds.length > 0 ? notInArray(alertFollows.dentistId, [...dentistIds]) : undefined,
          ),
        );
      if (dentistIds.length === 0) return;
      await tx
        .insert(alertFollows)
        .values(dentistIds.map((dentistId) => ({ id: newId(), userId, dentistId })))
        .onConflictDoNothing();
    });
  }
}
