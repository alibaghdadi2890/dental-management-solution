import {
  type GrantablePermission,
  GRANTABLE_PERMISSIONS,
  type RoleTemplate,
  SYSTEM_ROLE_KEYS,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { Transaction } from '../../../platform/db/database';
import { newId } from '../../../platform/kernel/id';
import { roleTemplatePermissions, roleTemplates } from './schema';

const templateColumns = {
  id: roleTemplates.id,
  key: roleTemplates.key,
  name: roleTemplates.name,
  description: roleTemplates.description,
  system: roleTemplates.system,
  active: roleTemplates.active,
};

/** The catalog's grantable permissions among stored text, in catalog order. */
const grantableOnly = (values: readonly string[]): GrantablePermission[] => {
  const stored = new Set(values);
  return GRANTABLE_PERMISSIONS.filter((permission) => stored.has(permission));
};

/**
 * The platform's default roles (ADR-0056). Global tables: every method takes the transaction —
 * a tenant one to read them while seeding or resetting a clinic, `withoutTenant()` to write them.
 */
@Injectable()
export class RoleTemplatesRepository {
  async list(tx: Transaction): Promise<RoleTemplate[]> {
    const rows = await tx
      .select(templateColumns)
      .from(roleTemplates)
      .orderBy(asc(roleTemplates.createdAt), asc(roleTemplates.id));
    const grants = await tx
      .select({
        templateId: roleTemplatePermissions.templateId,
        permission: roleTemplatePermissions.permission,
      })
      .from(roleTemplatePermissions);
    // The system templates in the matrix's order (seeded together, so `created_at` ties), then
    // the extra ones as they were added.
    const rank = (key: string) => {
      const index = SYSTEM_ROLE_KEYS.findIndex((systemKey) => systemKey === key);
      return index === -1 ? SYSTEM_ROLE_KEYS.length : index;
    };
    return [...rows]
      .sort((a, b) => rank(a.key) - rank(b.key))
      .map((row) => ({
        ...row,
        permissions: grantableOnly(
          grants.filter((grant) => grant.templateId === row.id).map((grant) => grant.permission),
        ),
      }));
  }

  async byId(tx: Transaction, id: string): Promise<RoleTemplate | undefined> {
    return (await this.list(tx)).find((template) => template.id === id);
  }

  async byKey(tx: Transaction, key: string): Promise<RoleTemplate | undefined> {
    return (await this.list(tx)).find((template) => template.key === key);
  }

  async insert(
    tx: Transaction,
    template: { key: string; name: string; description: string | null; updatedBy: string },
  ): Promise<string> {
    const id = newId();
    // Off until switched on: a default being set up never reaches a new clinic half done.
    await tx.insert(roleTemplates).values({ id, system: false, active: false, ...template });
    return id;
  }

  async update(
    tx: Transaction,
    id: string,
    change: { name?: string; description?: string | null; active?: boolean; updatedBy: string },
  ): Promise<void> {
    await tx.update(roleTemplates).set(change).where(eq(roleTemplates.id, id));
  }

  async replacePermissions(
    tx: Transaction,
    templateId: string,
    permissions: readonly GrantablePermission[],
  ): Promise<void> {
    await tx
      .delete(roleTemplatePermissions)
      .where(eq(roleTemplatePermissions.templateId, templateId));
    if (permissions.length > 0) {
      await tx
        .insert(roleTemplatePermissions)
        .values(permissions.map((permission) => ({ templateId, permission })));
    }
  }
}
