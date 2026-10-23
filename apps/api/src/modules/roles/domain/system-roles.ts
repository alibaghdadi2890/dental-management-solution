import {
  GRANTABLE_PERMISSIONS,
  type GrantablePermission,
  type SystemRoleKey,
} from '@dcm/contracts';

export interface SystemRole {
  key: SystemRoleKey;
  name: string;
  permissions: readonly GrantablePermission[];
}

/**
 * The roles seeded in every tenant and their default permissions (feature 13a, ADR-0055): deny by
 * default, and the owner widens. The owner holds every permission by rule (`permissionsOf`), and
 * its rows list them all. Permissions nothing enforces yet (`compensation:*`) are included so the
 * feature that does migrates no role data. From ADR-0055 on, a migration only adds to these
 * roles, never removes: clinics edit them.
 */
export const SYSTEM_ROLES: readonly SystemRole[] = [
  { key: 'owner', name: 'Owner', permissions: GRANTABLE_PERMISSIONS },
  {
    key: 'dentist',
    name: 'Dentist',
    permissions: [
      'tenant:read',
      'user:read',
      'catalog:read',
      'patient:read',
      'patient:write',
      'visit:read',
      'visit:write',
      'visit:void',
      'visit:amend',
      'chart:write',
      'file:read',
      'file:write',
      'file:archive',
      'audit:read',
      'compensation:read',
    ],
  },
  {
    key: 'assistant',
    name: 'Assistant',
    permissions: [
      'tenant:read',
      'user:read',
      'catalog:read',
      'patient:read',
      'patient:write',
      'visit:read',
      'visit:read_all',
      'visit:write',
      'file:read',
      'file:write',
    ],
  },
  {
    key: 'frontdesk',
    name: 'Front desk',
    permissions: [
      'tenant:read',
      'user:read',
      'catalog:read',
      'patient:read',
      'patient:write',
      'visit:read',
      'visit:read_all',
      'payment:read',
      'payment:write',
      'file:read',
      'file:write',
    ],
  },
];

export function systemRole(key: SystemRoleKey): SystemRole {
  const role = SYSTEM_ROLES.find((candidate) => candidate.key === key);
  if (!role) {
    throw new Error(`Unknown system role ${key}`);
  }
  return role;
}
