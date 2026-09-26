import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Password policy for every password a person chooses or an admin sets. */
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/** Emails are compared case-insensitively everywhere (sign-in, lockout, uniqueness). */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

/** Body of `POST /auth/sign-in/email`. `rememberMe` is "Trust this workstation for 30 days". */
export const signInRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  rememberMe: z.boolean().default(false),
});
export type SignInRequest = z.infer<typeof signInRequestSchema>;

/** Body of `POST /session/password`; also completes a pending first-sign-in change. */
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/** Stable problem codes the sign-in flow reacts to. */
export const AUTH_PROBLEM_CODES = {
  invalidCredentials: 'auth.invalid_credentials',
  accountLocked: 'auth.account_locked',
  accountDeactivated: 'auth.account_deactivated',
  sessionExpired: 'auth.session_expired',
  passwordChangeRequired: 'auth.password_change_required',
  noTenant: 'auth.no_tenant',
  tenantSuspended: 'tenant.suspended',
} as const;
