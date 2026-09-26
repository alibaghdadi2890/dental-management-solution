import { describe, expect, it } from 'vitest';
import {
  resetPasswordRequestSchema,
  staffUserCreateSchema,
  staffUserPatchSchema,
  staffUserStatusChangeSchema,
} from './users.js';

const BRANCH = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';

describe('staffUserCreateSchema', () => {
  const input = {
    displayName: '  Dr. Ana Reyes ',
    email: 'Ana@Northgate.Dental',
    practitionerType: 'dentist',
    roleKeys: ['dentist'],
    branchIds: [BRANCH],
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

  it('cannot change the email or password', () => {
    expect(staffUserPatchSchema.parse({ email: 'x@y.z', displayName: 'A' })).toEqual({
      displayName: 'A',
    });
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
