import { describe, expect, it } from 'vitest';
import { roleKeySchema, roleSchema, SYSTEM_ROLE_KEYS } from './roles.js';

describe('SYSTEM_ROLE_KEYS', () => {
  it('seeds the four D4 roles and admin', () => {
    expect(SYSTEM_ROLE_KEYS).toEqual(['owner', 'admin', 'dentist', 'assistant', 'frontdesk']);
  });
});

describe('roleKeySchema', () => {
  it.each(['owner', 'frontdesk', 'lab_tech', 'nurse2'])('accepts %j', (key) => {
    expect(roleKeySchema.safeParse(key).success).toBe(true);
  });

  it.each(['Owner', 'front desk', '2nd', 'x', '_x', 'a'.repeat(41)])('rejects %j', (key) => {
    expect(roleKeySchema.safeParse(key).success).toBe(false);
  });
});

describe('roleSchema', () => {
  it('only carries catalog permissions', () => {
    const role = {
      id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e',
      key: 'frontdesk',
      name: 'Front desk',
      description: null,
      system: true,
      active: true,
      permissions: ['patient:read'],
      holders: 2,
    };
    expect(roleSchema.parse(role)).toEqual(role);
    expect(roleSchema.safeParse({ ...role, permissions: ['patient:delete'] }).success).toBe(false);
  });
});
