import { describe, expect, it } from 'vitest';
import { canReadVisit, visitScopeOf } from './visit-scope.js';

const visit = { dentistId: 'profile-a', startedBy: 'user-x' };

describe('visit scope', () => {
  it('reads every visit with visit:read_all', () => {
    const actor = { permissions: ['visit:read_all' as const], userId: 'u', profileId: null };
    expect(visitScopeOf(actor)).toEqual({ kind: 'all' });
    expect(canReadVisit(actor, visit)).toBe(true);
  });

  it('reads its own visits with visit:read: as the dentist or the starter', () => {
    const dentist = { permissions: ['visit:read' as const], userId: 'u', profileId: 'profile-a' };
    const starter = { permissions: ['visit:read' as const], userId: 'user-x', profileId: null };
    const other = { permissions: ['visit:read' as const], userId: 'u', profileId: 'profile-b' };
    expect(canReadVisit(dentist, visit)).toBe(true);
    expect(canReadVisit(starter, visit)).toBe(true);
    expect(canReadVisit(other, visit)).toBe(false);
  });

  it('reads nothing without visit:read', () => {
    const actor = { permissions: ['patient:read' as const], userId: 'user-x', profileId: null };
    expect(visitScopeOf(actor)).toEqual({ kind: 'none' });
    expect(canReadVisit(actor, visit)).toBe(false);
  });
});
