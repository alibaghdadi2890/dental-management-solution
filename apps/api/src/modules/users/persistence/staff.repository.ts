import type { PractitionerType } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { staffBranches, staffProfiles } from './schema';

export interface StaffProfile {
  authUserId: string;
  displayName: string;
  title: string | null;
  practitionerType: PractitionerType;
  phone: string | null;
  active: boolean;
  createdAt: Date;
}

export type NewStaffProfile = Omit<StaffProfile, 'active' | 'createdAt'>;
export type StaffProfilePatch = Partial<Omit<StaffProfile, 'authUserId' | 'createdAt'>>;

type ProfileRow = typeof staffProfiles.$inferSelect;

function toProfile(row: ProfileRow): StaffProfile {
  return {
    authUserId: row.authUserId,
    displayName: row.displayName,
    title: row.title,
    practitionerType: row.practitionerType as PractitionerType,
    phone: row.phone,
    active: row.active,
    createdAt: row.createdAt,
  };
}

/** Staff profiles and their branch assignments in the current tenant (RLS). */
@Injectable()
export class StaffRepository {
  constructor(private readonly db: TenantDb) {}

  list(): Promise<StaffProfile[]> {
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(staffProfiles)
          .orderBy(asc(staffProfiles.createdAt), asc(staffProfiles.id))
      ).map(toProfile),
    );
  }

  async byUserId(authUserId: string): Promise<StaffProfile | undefined> {
    const [row] = await this.db.run((tx) =>
      tx.select().from(staffProfiles).where(eq(staffProfiles.authUserId, authUserId)),
    );
    return row ? toProfile(row) : undefined;
  }

  async activeUserIds(): Promise<string[]> {
    const rows = await this.db.run((tx) =>
      tx
        .select({ authUserId: staffProfiles.authUserId })
        .from(staffProfiles)
        .where(eq(staffProfiles.active, true)),
    );
    return rows.map((row) => row.authUserId);
  }

  /** Active dentists, ordered by display name (for `UsersService.listPractitioners`). */
  practitioners(): Promise<StaffProfile[]> {
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(staffProfiles)
          .where(and(eq(staffProfiles.practitionerType, 'dentist'), eq(staffProfiles.active, true)))
          .orderBy(asc(staffProfiles.displayName))
      ).map(toProfile),
    );
  }

  /** Profiles among `authUserIds`, whatever their type or status (for `practitionersByIds`). */
  async byUserIds(authUserIds: readonly string[]): Promise<StaffProfile[]> {
    if (authUserIds.length === 0) return [];
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(staffProfiles)
          .where(inArray(staffProfiles.authUserId, [...authUserIds]))
          .orderBy(asc(staffProfiles.displayName))
      ).map(toProfile),
    );
  }

  async insert(profile: NewStaffProfile): Promise<void> {
    await this.db.run((tx) => tx.insert(staffProfiles).values(profile));
  }

  async update(authUserId: string, patch: StaffProfilePatch): Promise<void> {
    if (Object.keys(patch).length === 0) return;
    await this.db.run((tx) =>
      tx.update(staffProfiles).set(patch).where(eq(staffProfiles.authUserId, authUserId)),
    );
  }

  /** Branch ids per user, in assignment order. */
  async branchIdsOf(authUserIds: readonly string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>(authUserIds.map((id) => [id, []]));
    if (authUserIds.length === 0) return result;
    const rows = await this.db.run((tx) =>
      tx
        .select({ authUserId: staffBranches.authUserId, branchId: staffBranches.branchId })
        .from(staffBranches)
        .where(inArray(staffBranches.authUserId, [...authUserIds]))
        .orderBy(asc(staffBranches.position)),
    );
    for (const row of rows) {
      result.get(row.authUserId)?.push(row.branchId);
    }
    return result;
  }

  replaceBranches(authUserId: string, branchIds: readonly string[]): Promise<void> {
    return this.db.run(async (tx) => {
      await tx.delete(staffBranches).where(eq(staffBranches.authUserId, authUserId));
      if (branchIds.length > 0) {
        await tx
          .insert(staffBranches)
          .values(branchIds.map((branchId, position) => ({ authUserId, branchId, position })));
      }
    });
  }
}
