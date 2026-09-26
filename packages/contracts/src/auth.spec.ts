import { describe, expect, it } from 'vitest';
import {
  changePasswordRequestSchema,
  PASSWORD_MIN_LENGTH,
  passwordSchema,
  signInRequestSchema,
} from './auth.js';

describe('passwordSchema', () => {
  it(`requires at least ${PASSWORD_MIN_LENGTH} characters and at most 128`, () => {
    expect(passwordSchema.safeParse('short-pw1').success).toBe(false);
    expect(passwordSchema.safeParse('long-enough').success).toBe(true);
    expect(passwordSchema.safeParse('x'.repeat(129)).success).toBe(false);
  });
});

describe('signInRequestSchema', () => {
  it('normalises the email and does not trust the workstation by default', () => {
    expect(
      signInRequestSchema.parse({ email: '  Reyes@Example.COM ', password: 'secret' }),
    ).toEqual({ email: 'reyes@example.com', password: 'secret', rememberMe: false });
  });

  it('rejects malformed emails and empty passwords', () => {
    expect(signInRequestSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
    expect(signInRequestSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});

describe('changePasswordRequestSchema', () => {
  it('applies the password policy to the new password only', () => {
    expect(
      changePasswordRequestSchema.safeParse({ currentPassword: 'tmp', newPassword: 'a-new-secret' })
        .success,
    ).toBe(true);
    expect(
      changePasswordRequestSchema.safeParse({ currentPassword: 'tmp', newPassword: 'short' })
        .success,
    ).toBe(false);
  });
});
