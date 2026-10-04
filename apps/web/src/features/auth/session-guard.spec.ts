import { describe, expect, it } from 'vitest';
import { sessionWith } from '@/features/patients/patients.test-utils';
import { landingPath } from './session-guard';

describe('landingPath', () => {
  it('starts whoever collects without treating on the Today board', () => {
    expect(landingPath(sessionWith(['patient:read', 'visit:read', 'payment:write']))).toBe(
      '/today',
    );
  });

  it('starts whoever treats on Patients, payments or not', () => {
    expect(landingPath(sessionWith(['patient:read', 'visit:write', 'payment:write']))).toBe(
      '/patients',
    );
    expect(landingPath(sessionWith(['patient:read', 'visit:write']))).toBe('/patients');
  });

  it('starts a platform admin outside a clinic on the tenants list', () => {
    const admin = { ...sessionWith(['platform:admin']), platformAdmin: true, tenant: null };
    expect(landingPath(admin)).toBe('/admin/tenants');
  });
});
