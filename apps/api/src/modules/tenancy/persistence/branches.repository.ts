import type { Branch, BranchCreate, BranchPatch } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { isUniqueViolation } from '../../../platform/db/unique-violation';
import { BranchCodeTakenError, BranchNameTakenError } from '../domain/tenancy-errors';
import { branches } from './schema';

type BranchRow = typeof branches.$inferSelect;

function toBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    address: row.address,
    phone: row.phone,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

function conflicts(error: unknown): never {
  if (isUniqueViolation(error, 'branches_name_unique')) {
    throw new BranchNameTakenError('A branch with this name already exists');
  }
  if (isUniqueViolation(error, 'branches_code_unique')) {
    throw new BranchCodeTakenError('A branch with this code already exists');
  }
  throw error;
}

/** Branches of the current tenant (RLS). */
@Injectable()
export class BranchesRepository {
  constructor(private readonly db: TenantDb) {}

  list(): Promise<Branch[]> {
    return this.db.run(async (tx) =>
      (await tx.select().from(branches).orderBy(asc(branches.createdAt), asc(branches.id))).map(
        toBranch,
      ),
    );
  }

  async byId(id: string): Promise<Branch | undefined> {
    const [row] = await this.db.run((tx) => tx.select().from(branches).where(eq(branches.id, id)));
    return row ? toBranch(row) : undefined;
  }

  byIds(ids: readonly string[], options: { activeOnly?: boolean } = {}): Promise<Branch[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(branches)
          .where(
            and(
              inArray(branches.id, [...ids]),
              options.activeOnly ? eq(branches.active, true) : undefined,
            ),
          )
      ).map(toBranch),
    );
  }

  async insert(branch: BranchCreate): Promise<Branch> {
    try {
      const [row] = await this.db.run((tx) => tx.insert(branches).values(branch).returning());
      if (!row) throw new Error('branch insert returned no row');
      return toBranch(row);
    } catch (error) {
      return conflicts(error);
    }
  }

  async update(id: string, patch: BranchPatch): Promise<Branch> {
    try {
      const [row] = await this.db.run((tx) =>
        tx.update(branches).set(patch).where(eq(branches.id, id)).returning(),
      );
      if (!row) throw new Error('branch update matched no row');
      return toBranch(row);
    } catch (error) {
      return conflicts(error);
    }
  }
}
