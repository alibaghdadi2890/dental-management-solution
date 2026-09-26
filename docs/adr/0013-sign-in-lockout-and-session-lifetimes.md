# ADR-0013: Sign-in lockout and session lifetimes

- Status: Accepted
- Date: 2026-09-26

## Context

The POC login (D11): five failed attempts lock the account for 15 minutes and the error says how
many attempts are left; "Trust this workstation for 30 days" keeps a long session, otherwise the
session ends after 15 idle minutes, mirrored by a 60-second countdown dialog. better-auth has IP
rate limiting but no per-account lockout or idle timeout.

## Decision

- **Lockout** is tracked per normalised email in `auth_sign_in_throttle`, whether or not an
  account exists, so the response (`401 auth.invalid_credentials` with `attemptsLeft`, then
  `auth.account_locked` with `lockedUntil`) never reveals which emails are registered. Five
  consecutive failures lock for 15 minutes; success clears the row; an expired lock starts a fresh
  count. The rules are a pure state machine (`auth/domain/sign-in-throttle.ts`); updates take a row
  lock.
- **Trusted workstation** (`rememberMe`) → persistent cookie and an absolute 30-day session
  (`expiresIn` 30 days, no sliding refresh). Otherwise a browser-session cookie (better-auth caps it
  at one day) and the idle timeout.
- **Idle timeout** is enforced by the session guard: an untrusted session whose `last_active_at` is
  older than 15 minutes is revoked (`401 auth.session_expired`). Activity is recorded at most once a
  minute; the SPA sends `POST /session/touch` on user activity and shows the countdown 60 seconds
  before the limit. `GET /session` returns `idleTimeoutSeconds` (null when trusted).
- Deactivated users are banned through the admin plugin: `403 auth.account_deactivated`.

## Consequences

- Time-dependent rules take an injectable `Clock`, so tests move time instead of waiting.
- An attacker can lock a known email for 15 minutes; accepted for a staff-only application.
