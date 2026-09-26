import type {
  PlatformTenantQuery,
  Tenant,
  TenantSettingsPatch,
  TenantStatus,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { Transaction } from '../../../platform/db/database';
import { TenantDb } from '../../../platform/db/tenant-db';
import { branches, tenants } from './schema';

type TenantRow = typeof tenants.$inferSelect;
export type NewTenant = Pick<
  typeof tenants.$inferInsert,
  'id' | 'name' | 'slug' | 'timeZone' | 'currency' | 'locale'
>;

export function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    timeZone: row.timeZone,
    currency: row.currency,
    locale: row.locale as Tenant['locale'],
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class TenantsRepository {
  constructor(private readonly db: TenantDb) {}

  // --- Cross-tenant (platform admin): `tx` comes from `withoutTenant()`. ---

  async insert(tx: Transaction, tenant: NewTenant): Promise<Tenant> {
    const [row] = await tx.insert(tenants).values(tenant).returning();
    if (!row) throw new Error('tenant insert returned no row');
    return toTenant(row);
  }

  async delete(tx: Transaction, id: string): Promise<void> {
    await tx.delete(tenants).where(eq(tenants.id, id));
  }

  async listWithBranchCounts(
    tx: Transaction,
    query: PlatformTenantQuery,
  ): Promise<(Tenant & { branchCount: number })[]> {
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(tenants.status, query.status));
    if (query.search) {
      const pattern = `%${query.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      const match = or(ilike(tenants.name, pattern), ilike(tenants.slug, pattern));
      if (match) conditions.push(match);
    }
    const rows = await tx
      .select({ tenant: tenants, branchCount: count(branches.id) })
      .from(tenants)
      .leftJoin(branches, eq(branches.tenantId, tenants.id))
      .where(and(...conditions))
      .groupBy(tenants.id)
      .orderBy(asc(tenants.name));
    return rows.map((row) => ({ ...toTenant(row.tenant), branchCount: row.branchCount }));
  }

  // --- Inside the tenant: RLS (`tenant_self`) only ever shows the current tenant's row. ---

  async current(): Promise<Tenant | undefined> {
    const [row] = await this.db.run((tx) => tx.select().from(tenants));
    return row ? toTenant(row) : undefined;
  }

  async update(
    id: string,
    patch: TenantSettingsPatch & { status?: TenantStatus },
  ): Promise<Tenant> {
    const [row] = await this.db.run((tx) =>
      tx.update(tenants).set(patch).where(eq(tenants.id, id)).returning(),
    );
    if (!row) throw new Error('tenant update matched no row');
    return toTenant(row);
  }
}
