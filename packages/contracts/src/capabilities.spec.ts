import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_GROUPS,
  CAPABILITY_IMPLIES,
  capabilityI18nKey,
  closeImplied,
  impliedBy,
} from './capabilities.js';
import { GRANTABLE_PERMISSIONS } from './permissions.js';

describe('capability catalog', () => {
  it('lists every grantable permission exactly once, and never platform:admin', () => {
    const listed: string[] = CAPABILITY_GROUPS.flatMap((group) => [...group.permissions]);
    expect([...listed].sort()).toEqual([...GRANTABLE_PERMISSIONS].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('implies only grantable permissions and has no cycles', () => {
    for (const [permission, implied] of Object.entries(CAPABILITY_IMPLIES)) {
      for (const target of implied) {
        expect(GRANTABLE_PERMISSIONS).toContain(target);
        expect(target).not.toBe(permission);
      }
    }
  });

  it('closes a set under implies, in catalog order', () => {
    expect(closeImplied(['finance:read'])).toEqual(['payment:read', 'finance:read']);
    expect(closeImplied(['role:write', 'visit:read_all'])).toEqual([
      'visit:read',
      'visit:read_all',
      'user:read',
      'role:read',
      'role:write',
    ]);
    expect(closeImplied([])).toEqual([]);
  });

  it('says which permissions of a set hold another on', () => {
    expect(impliedBy('payment:read', ['payment:write', 'finance:read', 'visit:read'])).toEqual([
      'payment:write',
      'finance:read',
    ]);
    expect(impliedBy('payment:read', ['payment:read'])).toEqual([]);
  });

  it('turns a permission into an i18n key stem', () => {
    expect(capabilityI18nKey('visit:read_all')).toBe('visit_read_all');
  });
});
