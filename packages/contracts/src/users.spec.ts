import { describe, expect, it } from 'vitest';
import {
  practitionerQuerySchema,
  practitionerSchema,
  resetPasswordRequestSchema,
  staffUserCreateSchema,
  staffUserPatchSchema,
  staffUserSchema,
  staffUserStatusChangeSchema,
} from './users.js';

const BRANCH_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';
const USER_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f';
const PROFILE_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d70';

describe('staffUserCreateSchema', () => {
  const input = {
    displayName: '  Dr. Ana Reyes ',
    email: 'Ana@Northgate.Dental',
    practitionerType: 'dentist',
    primarySpecialty: 'general',
    specialties: ['general'],
    roleKeys: ['dentist'],
    branchIds: [BRANCH_ID],
    temporaryPassword: 'temporary-pw-1',
  };

  it('normalises names and email and treats blank optional text as unset', () => {
    expect(staffUserCreateSchema.parse({ ...input, title: ' ', phone: '' })).toMatchObject({
      displayName: 'Dr. Ana Reyes',
      email: 'ana@northgate.dental',
      title: null,
      phone: null,
    });
  });

  it('requires at least one role and one branch', () => {
    expect(staffUserCreateSchema.safeParse({ ...input, roleKeys: [] }).success).toBe(false);
    expect(staffUserCreateSchema.safeParse({ ...input, branchIds: [] }).success).toBe(false);
  });

  it('gives a dentist a primary specialty among their specialties, and no one else any', () => {
    const ortho = { primarySpecialty: 'orthodontics', specialties: ['general', 'orthodontics'] };
    expect(staffUserCreateSchema.parse({ ...input, ...ortho })).toMatchObject(ortho);
    const none = { primarySpecialty: null, specialties: [] };
    expect(staffUserCreateSchema.safeParse({ ...input, ...none }).success).toBe(false);
    const { primarySpecialty: _p, specialties: _s, ...withoutThem } = input;
    expect(staffUserCreateSchema.parse(withoutThem).specialties).toBeUndefined();
    const half = { ...withoutThem, specialties: ['general'] };
    expect(staffUserCreateSchema.safeParse(half).success).toBe(false);
    const outside = { primarySpecialty: 'cosmetic', specialties: ['general'] };
    expect(staffUserCreateSchema.safeParse({ ...input, ...outside }).success).toBe(false);
    const assistant = { ...input, ...none, practitionerType: 'assistant' };
    expect(staffUserCreateSchema.safeParse(assistant).success).toBe(true);
    expect(staffUserCreateSchema.safeParse({ ...assistant, ...ortho }).success).toBe(false);
  });

  it('applies the password policy and the practitioner types', () => {
    expect(staffUserCreateSchema.safeParse({ ...input, temporaryPassword: 'short' }).success).toBe(
      false,
    );
    expect(staffUserCreateSchema.safeParse({ ...input, practitionerType: 'nurse' }).success).toBe(
      false,
    );
  });
});

describe('staffUserPatchSchema', () => {
  it('leaves absent fields absent and refuses an empty patch', () => {
    expect(staffUserPatchSchema.parse({ title: 'Hygienist' })).toEqual({ title: 'Hygienist' });
    expect(staffUserPatchSchema.safeParse({}).success).toBe(false);
  });

  it('takes the specialties as a pair that agrees with itself', () => {
    const pair = { primarySpecialty: 'general', specialties: ['general', 'implantology'] };
    expect(staffUserPatchSchema.parse(pair)).toEqual(pair);
    expect(staffUserPatchSchema.parse({ primarySpecialty: null, specialties: [] })).toEqual({
      primarySpecialty: null,
      specialties: [],
    });
    expect(staffUserPatchSchema.safeParse({ specialties: ['general'] }).success).toBe(false);
    expect(staffUserPatchSchema.safeParse({ primarySpecialty: 'general' }).success).toBe(false);
    const outside = { primarySpecialty: 'cosmetic', specialties: ['general'] };
    expect(staffUserPatchSchema.safeParse(outside).success).toBe(false);
    const twice = { primarySpecialty: 'general', specialties: ['general', 'general'] };
    expect(staffUserPatchSchema.safeParse(twice).success).toBe(false);
  });

  it('cannot change the email or password', () => {
    expect(staffUserPatchSchema.parse({ email: 'x@y.z', displayName: 'A' })).toEqual({
      displayName: 'A',
    });
  });
});

describe('practitionerSchema', () => {
  it('accepts a nullable title and carries both the profile id and the user id', () => {
    const practitioner = {
      id: PROFILE_ID,
      userId: USER_ID,
      displayName: 'Dr. Ana Reyes',
      title: null,
    };
    expect(practitionerSchema.parse(practitioner)).toEqual(practitioner);
    expect(practitionerSchema.parse({ ...practitioner, title: 'Orthodontist' }).title).toBe(
      'Orthodontist',
    );
  });

  it('requires the profile id', () => {
    expect(
      practitionerSchema.safeParse({ userId: USER_ID, displayName: 'Dr. Ana Reyes', title: null })
        .success,
    ).toBe(false);
  });
});

describe('practitionerQuerySchema', () => {
  it('leaves branchId unset when absent, and accepts one when given', () => {
    expect(practitionerQuerySchema.parse({})).toEqual({});
    expect(practitionerQuerySchema.parse({ branchId: BRANCH_ID })).toEqual({
      branchId: BRANCH_ID,
    });
  });

  it('rejects a branchId that is not a uuid', () => {
    expect(practitionerQuerySchema.safeParse({ branchId: 'main' }).success).toBe(false);
  });
});

describe('staffUserSchema', () => {
  it('carries the staff profile id alongside the auth user id', () => {
    const staffUser = {
      id: USER_ID,
      profileId: PROFILE_ID,
      email: 'ana@northgate.dental',
      displayName: 'Dr. Ana Reyes',
      title: null,
      practitionerType: 'dentist',
      primarySpecialty: 'general',
      specialties: ['general'],
      phone: null,
      active: true,
      roles: [],
      grants: ['finance:read'],
      effectivePermissions: null,
      branches: [],
      createdAt: '2026-01-01T10:00:00.000Z',
    };
    expect(staffUserSchema.parse(staffUser)).toEqual(staffUser);
    expect(staffUserSchema.safeParse({ ...staffUser, grants: ['platform:admin'] }).success).toBe(
      false,
    );
  });

  it('requires the profile id', () => {
    const { profileId: _profileId, ...withoutProfileId } = {
      id: USER_ID,
      profileId: PROFILE_ID,
      email: 'ana@northgate.dental',
      displayName: 'Dr. Ana Reyes',
      title: null,
      practitionerType: 'dentist',
      primarySpecialty: 'general',
      specialties: ['general'],
      phone: null,
      active: true,
      roles: [],
      branches: [],
      createdAt: '2026-01-01T10:00:00.000Z',
    };
    expect(staffUserSchema.safeParse(withoutProfileId).success).toBe(false);
  });
});

describe('status and password requests', () => {
  it('require a reason and a policy-compliant temporary password', () => {
    expect(staffUserStatusChangeSchema.safeParse({ reason: 'x' }).success).toBe(false);
    expect(staffUserStatusChangeSchema.safeParse({ reason: 'Left the clinic' }).success).toBe(true);
    expect(resetPasswordRequestSchema.safeParse({ temporaryPassword: 'short' }).success).toBe(
      false,
    );
  });
});
