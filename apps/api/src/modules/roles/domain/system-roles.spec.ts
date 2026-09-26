import { isPermission, PERMISSIONS, SYSTEM_ROLE_KEYS } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { SYSTEM_ROLES, systemRole } from './system-roles';

const sorted = (values: readonly string[]) => [...values].sort();

/** The D5 permission matrix, written out per role so any change is a visible diff. */
const D5 = {
  owner: PERMISSIONS.filter((permission) => permission !== 'platform:admin'),
  dentist: [
    'tenant:read',
    'user:read',
    'patient:read',
    'patient:write',
    'visit:read',
    'visit:write',
    'visit:void',
    'visit:amend',
    'procedure:read',
    'payment:read',
    'payment:write',
    'payment:refund',
    'audit:read',
  ],
  assistant: [
    'tenant:read',
    'user:read',
    'patient:read',
    'patient:write',
    'visit:read',
    'visit:write',
    'procedure:read',
    'payment:read',
  ],
  frontdesk: [
    'tenant:read',
    'user:read',
    'patient:read',
    'patient:write',
    'visit:read',
    'procedure:read',
    'payment:read',
    'payment:write',
  ],
} as const;

describe('system roles (D4, D5)', () => {
  it('are the four seeded roles, in order', () => {
    expect(SYSTEM_ROLES.map((role) => role.key)).toEqual([...SYSTEM_ROLE_KEYS]);
  });

  it.each(SYSTEM_ROLE_KEYS)('grants %s exactly the D5 permissions', (key) => {
    expect(sorted(systemRole(key).permissions)).toEqual(sorted(D5[key]));
  });

  it('gives the owner everything but platform:admin', () => {
    const missing = PERMISSIONS.filter(
      (permission) => !systemRole('owner').permissions.includes(permission),
    );
    expect(missing).toEqual(['platform:admin']);
  });

  it('only uses catalog permissions, never platform:admin, never twice', () => {
    for (const role of SYSTEM_ROLES) {
      expect(role.permissions.every((permission) => isPermission(permission))).toBe(true);
      expect(role.permissions).not.toContain('platform:admin');
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
  });

  it('has display names', () => {
    expect(SYSTEM_ROLES.map((role) => role.name)).toEqual([
      'Owner',
      'Dentist',
      'Assistant',
      'Front desk',
    ]);
  });
});
