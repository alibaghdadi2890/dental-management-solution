import { z } from 'zod';

/**
 * The permission catalog: the shared vocabulary between API guards, agent tools and UI visibility.
 * Never invent a permission inline — add it here (CLAUDE.md §6).
 */
export const PERMISSIONS = [
  'platform:admin',
  'tenant:read',
  'tenant:write',
  'user:read',
  'user:write',
  'role:read',
  'role:write',
  'patient:read',
  'patient:write',
  'visit:read',
  'visit:read_all',
  'visit:write',
  'visit:void',
  'visit:amend',
  'visit:discount',
  'chart:write',
  'catalog:read',
  'catalog:write',
  'payment:read',
  'payment:write',
  'payment:refund',
  'finance:read',
  'import:run',
  'file:read',
  'file:write',
  'file:archive',
  'audit:read',
  'compensation:read',
  'compensation:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const permissionSchema = z.enum(PERMISSIONS);

const catalog: ReadonlySet<string> = new Set(PERMISSIONS);

/**
 * Every permission a role or a per-user grant can carry: `platform:admin` belongs to platform
 * admins only and is never granted (ADR-0008).
 */
export const GRANTABLE_PERMISSIONS = PERMISSIONS.filter(
  (permission): permission is Exclude<Permission, 'platform:admin'> =>
    permission !== 'platform:admin',
);
export type GrantablePermission = (typeof GRANTABLE_PERMISSIONS)[number];

export const grantablePermissionSchema = z.enum(
  GRANTABLE_PERMISSIONS as [GrantablePermission, ...GrantablePermission[]],
);

export function isPermission(value: string): value is Permission {
  return catalog.has(value);
}
