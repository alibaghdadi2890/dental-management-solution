import type { ChangePasswordRequest, SignInRequest } from '@dcm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';

const noContent = z.undefined();

/** Sets the session cookie; the SPA then reads `GET /session`. */
export function signIn(body: SignInRequest): Promise<undefined> {
  return apiFetch('/auth/sign-in/email', noContent, { method: 'POST', json: body });
}

export function signOut(): Promise<undefined> {
  return apiFetch('/auth/sign-out', noContent, { method: 'POST', json: {} });
}

/** Completes a first sign-in with a temporary password (D6). */
export function changePassword(body: ChangePasswordRequest): Promise<undefined> {
  return apiFetch('/session/password', noContent, { method: 'POST', json: body });
}

export function switchBranch(branchId: string): Promise<undefined> {
  return apiFetch('/session/branch', noContent, { method: 'POST', json: { branchId } });
}

/** Idle heartbeat for untrusted sessions (D11). */
export function touchSession(): Promise<undefined> {
  return apiFetch('/session/touch', noContent, { method: 'POST' });
}
