import {
  type Role,
  type RoleCreate,
  roleSchema,
  type RoleTemplate,
  roleTemplateSchema,
  type RoleUpdate,
} from '@dcm/contracts';
import type { QueryKey } from '@tanstack/react-query';
import { z } from 'zod';
import { createRole, platformKeys, roleAction, updateRole } from '@/features/platform/platform-api';
import { apiFetch } from '@/lib/api';

/** A row of the roles screen: a clinic's role (with its holders) or a platform template. */
export type RoleRow = Role | RoleTemplate;

export type RoleAction = 'deactivate' | 'reactivate' | 'reset';

/**
 * Where the roles screen reads and writes (ADR-0055, ADR-0056): one clinic's roles (Settings ›
 * Roles, the admin portal's tenant page) or the platform's default roles (the admin portal).
 */
export interface RolesSource {
  kind: 'clinic' | 'platform';
  queryKey: QueryKey;
  list: () => Promise<RoleRow[]>;
  create: (input: RoleCreate) => Promise<RoleRow>;
  update: (id: string, patch: RoleUpdate) => Promise<RoleRow>;
  action: (id: string, action: RoleAction) => Promise<RoleRow>;
  /** What else shows the roles and must be refreshed after a change. */
  refresh: QueryKey[];
}

export function clinicRoles(tenantId: string): RolesSource {
  return {
    kind: 'clinic',
    queryKey: platformKeys.roles(tenantId),
    list: () => apiFetch('/roles', z.array(roleSchema), { tenantId }),
    create: (input) => createRole(tenantId, input),
    update: (id, patch) => updateRole(tenantId, id, patch),
    action: (id, action) => roleAction(tenantId, id, action),
    refresh: [platformKeys.roles(tenantId), platformKeys.users(tenantId)],
  };
}

const TEMPLATES_KEY = ['platform', 'role-templates'] as const;
const PATH = '/platform/role-templates';

/** The platform's default roles: what new clinics are created with (ADR-0056). */
export function platformRoleTemplates(): RolesSource {
  return {
    kind: 'platform',
    queryKey: TEMPLATES_KEY,
    list: () => apiFetch(PATH, z.array(roleTemplateSchema)),
    create: (input) => apiFetch(PATH, roleTemplateSchema, { method: 'POST', json: input }),
    update: (id, patch) =>
      apiFetch(`${PATH}/${id}`, roleTemplateSchema, { method: 'PATCH', json: patch }),
    action: (id, action) =>
      apiFetch(`${PATH}/${id}/${action}`, roleTemplateSchema, { method: 'POST' }),
    refresh: [TEMPLATES_KEY],
  };
}
