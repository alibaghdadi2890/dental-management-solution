import type { PractitionerType } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { staffBranches, staffProfiles } from './schema';

export interface StaffProfile {
  /** `staff_profiles.id` — the id a domain model refers to a staff member in a clinical role by
   * (ADR-0020), e.g. a patient's primary dentist. */
  id: string;
  authUserId: string;
  displayName: string;
  title: string | null;
  practitionerType: PractitionerType;
  phone: string | null;
  active: boolean;
  createdAt: Date;
}

export type NewStaffProfile = Omit<StaffProfile, 'id' | 'active' | 'createdAt'>;
export type StaffProfilePatch = Partial<Omit<StaffProfile, 'id' | 'authUserId' | 'createdAt'>>;

type ProfileRow = typeof staffProfiles.$inferSelect;

function toProfile(row: ProfileRow): StaffProfile {
  return {
    id: row.id,
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

  /**
   * Active dentists, ordered by id for a deterministic DB-level order (for
   * `UsersService.listPractitioners`, which re-sorts by display name in the tenant's locale — DB
   * byte-order is not locale-aware).
   */
  practitioners(): Promise<StaffProfile[]> {
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(staffProfiles)
          .where(and(eq(staffProfiles.practitionerType, 'dentist'), eq(staffProfiles.active, true)))
          .orderBy(asc(staffProfiles.authUserId))
      ).map(toProfile),
    );
  }

  /**
   * Profiles among `authUserIds`, whatever their type or status, ordered by id (for
   * `practitionersByIds`, which re-sorts by display name the same way as `practitioners`).
   *
   * Superseded by `byProfileIds`: domain models refer to a dentist by the staff profile id, not
   * the auth user id (ADR-0020). Kept only for the `patients` and `billing` callers that still
   * store the auth user id; the patients-contacts addendum (task H1/H2) moves them to
   * `byProfileIds` and removes this method.
   */
  async byUserIds(authUserIds: readonly string[]): Promise<StaffProfile[]> {
    if (authUserIds.length === 0) return [];
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(staffProfiles)
          .where(inArray(staffProfiles.authUserId, [...authUserIds]))
          .orderBy(asc(staffProfiles.authUserId))
      ).map(toProfile),
    );
  }

  /**
   * Profiles among `profileIds` (`staff_profiles.id`, ADR-0020), whatever their type or status,
   * ordered by id (for `practitionersByProfileIds`, which re-sorts by display name the same way
   * as `practitioners`). Includes deactivated staff, so a dentist's name still resolves after
   * they leave the clinic.
   */
  async byProfileIds(profileIds: readonly string[]): Promise<StaffProfile[]> {
    if (profileIds.length === 0) return [];
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(staffProfiles)
          .where(inArray(staffProfiles.id, [...profileIds]))
          .orderBy(asc(staffProfiles.id))
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
