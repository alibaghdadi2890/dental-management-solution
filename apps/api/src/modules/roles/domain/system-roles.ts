import { type Permission, PERMISSIONS, type SystemRoleKey } from '@dcm/contracts';

export interface SystemRole {
  key: SystemRoleKey;
  name: string;
  permissions: readonly Permission[];
}

/** Everything a clinic user can hold; `platform:admin` belongs to platform admins only (D9). */
const ALL_CLINIC_PERMISSIONS = PERMISSIONS.filter((permission) => permission !== 'platform:admin');

/**
 * The roles seeded in every tenant and the D5 permission matrix. Permissions that no route
 * enforces yet are included so later features do not migrate role data.
 */
export const SYSTEM_ROLES: readonly SystemRole[] = [
  { key: 'owner', name: 'Owner', permissions: ALL_CLINIC_PERMISSIONS },
  {
    key: 'dentist',
    name: 'Dentist',
    permissions: [
      'tenant:read',
      'user:read',
      'patient:read',
      'patient:write',
      'visit:read',
      'visit:write',
      'visit:void',
      'visit:amend',
      'visit:discount',
      'chart:write',
      'catalog:read',
      'payment:read',
      'payment:write',
      'payment:refund',
      'audit:read',
      'file:read',
      'file:write',
      'file:archive',
    ],
  },
  {
    key: 'assistant',
    name: 'Assistant',
    permissions: [
      'tenant:read',
      'user:read',
      'patient:read',
      'patient:write',
      'visit:read',
      'visit:write',
      'catalog:read',
      'payment:read',
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
      'patient:read',
      'patient:write',
      'visit:read',
      'visit:discount',
      'catalog:read',
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
