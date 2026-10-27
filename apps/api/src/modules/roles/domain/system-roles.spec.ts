import { closeImplied, isPermission, PERMISSIONS, SYSTEM_ROLE_KEYS } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { SYSTEM_ROLES, systemRole } from './system-roles';

const sorted = (values: readonly string[]) => [...values].sort();

/** The feature 13a default matrix (ADR-0055), written out per role so any change is a visible
 * diff. */
const MATRIX = {
  owner: PERMISSIONS.filter((permission) => permission !== 'platform:admin'),
  admin: PERMISSIONS.filter((permission) => permission !== 'platform:admin'),
  dentist: [
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
  assistant: [
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
  frontdesk: [
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
} as const;

describe('system roles (ADR-0055)', () => {
  it('are the seeded roles, in order', () => {
    expect(SYSTEM_ROLES.map((role) => role.key)).toEqual([...SYSTEM_ROLE_KEYS]);
  });

  it.each(SYSTEM_ROLE_KEYS)('grants %s exactly the default matrix', (key) => {
    expect(sorted(systemRole(key).permissions)).toEqual(sorted(MATRIX[key]));
  });

  it.each(['owner', 'admin'] as const)('gives the %s everything but platform:admin', (key) => {
    const missing = PERMISSIONS.filter(
      (permission) => !(systemRole(key).permissions as readonly string[]).includes(permission),
    );
    expect(missing).toEqual(['platform:admin']);
  });

  it('only uses catalog permissions, never twice, and is closed under implies', () => {
    for (const role of SYSTEM_ROLES) {
      expect(role.permissions.every((permission) => isPermission(permission))).toBe(true);
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
      expect(sorted(closeImplied(role.permissions))).toEqual(sorted(role.permissions));
    }
  });

  it('keeps money and discounts with the owner, payments with front desk', () => {
    for (const key of ['dentist', 'assistant', 'frontdesk'] as const) {
      expect(systemRole(key).permissions).not.toContain('visit:discount');
      expect(systemRole(key).permissions).not.toContain('finance:read');
      expect(systemRole(key).permissions).not.toContain('payment:refund');
    }
    expect(systemRole('dentist').permissions).not.toContain('payment:read');
    expect(systemRole('dentist').permissions).not.toContain('visit:read_all');
  });

  it('has display names', () => {
    expect(SYSTEM_ROLES.map((role) => role.name)).toEqual([
      'Owner',
      'Admin',
      'Dentist',
      'Assistant',
      'Front desk',
    ]);
  });
});
