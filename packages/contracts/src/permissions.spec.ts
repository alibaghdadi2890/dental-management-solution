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
