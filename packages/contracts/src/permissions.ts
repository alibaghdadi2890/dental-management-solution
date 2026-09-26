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
  'visit:write',
  'visit:void',
  'visit:amend',
  'procedure:read',
  'procedure:write',
  'payment:read',
  'payment:write',
  'payment:refund',
  'import:run',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const permissionSchema = z.enum(PERMISSIONS);

const catalog: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return catalog.has(value);
}
