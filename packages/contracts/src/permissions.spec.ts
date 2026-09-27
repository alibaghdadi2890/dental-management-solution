import { describe, expect, it } from 'vitest';
import { PERMISSIONS, isPermission, permissionSchema } from './permissions.js';

describe('permission catalog', () => {
  it('uses resource:action naming for every entry', () => {
    for (const permission of PERMISSIONS) {
      expect(permission).toMatch(/^[a-z][a-z-]*:[a-z][a-z-]*$/);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it('recognises catalog entries and rejects invented ones', () => {
    expect(isPermission('patient:read')).toBe(true);
    expect(isPermission('patient:delete-everything')).toBe(false);
  });

  it('validates permissions through the Zod schema', () => {
    expect(permissionSchema.safeParse('visit:write').success).toBe(true);
    expect(permissionSchema.safeParse('visit:explode').success).toBe(false);
  });
});

describe('phase 1 catalog', () => {
  it('names the service and diagnosis catalog permissions catalog:*, not procedure:*', () => {
    expect(isPermission('catalog:read')).toBe(true);
    expect(isPermission('catalog:write')).toBe(true);
    expect(PERMISSIONS.filter((permission) => permission.startsWith('procedure:'))).toEqual([]);
  });

  it('includes the visit and payment permissions later features enforce', () => {
    for (const permission of [
      'visit:void',
      'visit:amend',
      'payment:read',
      'payment:write',
      'payment:refund',
    ]) {
      expect(isPermission(permission)).toBe(true);
    }
  });
});
