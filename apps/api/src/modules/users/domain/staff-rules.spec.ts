import { describe, expect, it } from 'vitest';
import {
  assertAssignments,
  assertKeepsAnOwner,
  assertNotSelf,
  resolveSpecialties,
  SpecialtyNotAllowedError,
  SpecialtyRequiredError,
} from './staff-rules';

describe('assertKeepsAnOwner', () => {
  it('refuses to take away the only active owner', () => {
    expect(() => {
      assertKeepsAnOwner(['owner-1'], 'owner-1');
    }).toThrow(expect.objectContaining({ code: 'user.last_owner', kind: 'conflict' }));
  });

  it('allows it while another active owner remains', () => {
    expect(() => {
      assertKeepsAnOwner(['owner-1', 'owner-2'], 'owner-1');
    }).not.toThrow();
  });

  it('ignores users who are not active owners', () => {
    expect(() => {
      assertKeepsAnOwner(['owner-1'], 'dentist-1');
    }).not.toThrow();
  });
});

describe('assertNotSelf', () => {
  it('refuses to deactivate yourself', () => {
    expect(() => {
      assertNotSelf('user-1', 'user-1');
    }).toThrow(expect.objectContaining({ code: 'user.self_deactivation', kind: 'conflict' }));
  });

  it('allows acting on someone else, or without a user (system)', () => {
    expect(() => {
      assertNotSelf('user-1', 'user-2');
    }).not.toThrow();
    expect(() => {
      assertNotSelf(undefined, 'user-2');
    }).not.toThrow();
  });
});

describe('assertAssignments', () => {
  it('requires at least one role and one branch', () => {
    expect(() => {
      assertAssignments({ roleKeys: [], branchIds: ['b'] });
    }).toThrow(expect.objectContaining({ code: 'user.role_required', kind: 'invalid' }));
    expect(() => {
      assertAssignments({ roleKeys: ['owner'], branchIds: [] });
    }).toThrow(expect.objectContaining({ code: 'user.branch_required', kind: 'invalid' }));
  });

  it('only checks what the change touches', () => {
    expect(() => {
      assertAssignments({});
    }).not.toThrow();
    expect(() => {
      assertAssignments({ roleKeys: ['frontdesk'], branchIds: ['b'] });
    }).not.toThrow();
  });
});

describe('resolveSpecialties', () => {
  const dentist = {
    practitionerType: 'dentist' as const,
    primarySpecialty: 'orthodontics' as const,
    specialties: ['general' as const, 'orthodontics' as const],
  };
  const assistant = {
    practitionerType: 'assistant' as const,
    primarySpecialty: null,
    specialties: [],
  };
  const endo = { primarySpecialty: 'endodontics' as const, specialties: ['endodontics' as const] };

  it('starts a new dentist created without specialties on General dentistry', () => {
    expect(resolveSpecialties(null, { practitionerType: 'dentist' })).toEqual({
      primarySpecialty: 'general',
      specialties: ['general'],
    });
  });

  it('stores the specialties a new dentist is created with, and none for anyone else', () => {
    expect(resolveSpecialties(null, { practitionerType: 'dentist', ...endo })).toEqual(endo);
    expect(
      resolveSpecialties(null, {
        practitionerType: 'frontdesk',
        primarySpecialty: null,
        specialties: [],
      }),
    ).toEqual({ primarySpecialty: null, specialties: [] });
  });

  it('keeps a dentist’s stored specialties unless new ones are sent', () => {
    expect(resolveSpecialties(dentist, {})).toEqual({
      primarySpecialty: 'orthodontics',
      specialties: ['general', 'orthodontics'],
    });
    expect(resolveSpecialties(dentist, endo)).toEqual(endo);
  });

  it('clears them when a dentist becomes another type', () => {
    expect(resolveSpecialties(dentist, { practitionerType: 'assistant' })).toEqual({
      primarySpecialty: null,
      specialties: [],
    });
  });

  it('requires one for a dentist', () => {
    expect(() => resolveSpecialties(assistant, { practitionerType: 'dentist' })).toThrow(
      SpecialtyRequiredError,
    );
    expect(() => resolveSpecialties(dentist, { primarySpecialty: null, specialties: [] })).toThrow(
      SpecialtyRequiredError,
    );
    expect(resolveSpecialties(assistant, { practitionerType: 'dentist', ...endo })).toEqual(endo);
  });

  it('refuses specialties for anyone but a dentist', () => {
    expect(() => resolveSpecialties(assistant, endo)).toThrow(SpecialtyNotAllowedError);
    expect(() => resolveSpecialties(dentist, { practitionerType: 'other', ...endo })).toThrow(
      SpecialtyNotAllowedError,
    );
  });
});
