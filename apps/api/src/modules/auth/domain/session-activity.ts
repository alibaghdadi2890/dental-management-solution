/**
 * Idle timeout for sessions on untrusted workstations (D11, ADR-0013). The SPA mirrors it with the
 * POC's 60-second countdown and reports activity through `POST /session/touch`.
 */
export const IDLE_TIMEOUT_MS = 15 * 60_000;
export const TOUCH_INTERVAL_MS = 60_000;

export interface SessionActivityState {
  trusted: boolean;
  lastActiveAt: Date;
}

/** `expired`: revoke; `touch`: still valid, record activity; `fresh`: nothing to do. */
export type SessionActivity = 'expired' | 'touch' | 'fresh';

export function sessionActivity(session: SessionActivityState, now: Date): SessionActivity {
  if (session.trusted) {
    return 'fresh';
  }
  const idleFor = now.getTime() - session.lastActiveAt.getTime();
  if (idleFor > IDLE_TIMEOUT_MS) {
    return 'expired';
  }
  return idleFor > TOUCH_INTERVAL_MS ? 'touch' : 'fresh';
}

export function idleTimeoutSeconds(trusted: boolean): number | null {
  return trusted ? null : IDLE_TIMEOUT_MS / 1_000;
}
