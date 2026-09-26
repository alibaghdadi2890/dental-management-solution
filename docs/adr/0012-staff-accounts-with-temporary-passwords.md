# ADR-0012: Staff accounts with temporary passwords

- Status: Accepted
- Date: 2026-09-26
- Supersedes: ADR-0004 in part (owner invitation by email; owners managing their own members)

## Context

ADR-0004 had provisioning invite the clinic owner by email and let owners manage their own
members. Feature 1 ships without email delivery or invitations, and only platform admins
configure clinics for now (D1, D6). better-auth's organization plugin has an invitation flow, but
using it would need email and an accept-invitation screen that is not designed.

## Decision

- A platform admin creates every staff account — including the owner during provisioning — with a
  name, email, roles, branches and a **temporary password** (policy: 10–128 characters; the SPA
  offers a generator). The account is flagged `mustChangePassword`.
- While the flag is set, the session guard lets through only reading the session, the idle
  heartbeat, sign-out and `POST /session/password`; everything else answers
  `403 auth.password_change_required`. Changing the password checks the temporary one, refuses
  keeping it (`422 auth.password_unchanged`), clears the flag and signs out the user's other
  sessions.
- A platform admin can **reset** a password to a new temporary one: the flag is set again and every
  session of the user ends.
- The owner is created by `users.createStaffUser` inside the provisioning transaction with the
  `owner` role and the first branch, so a failure leaves no identity behind (ADR-0009).
- Temporary passwords are never stored anywhere but the credential hash, and never written to the
  audit log (`redactSecrets` drops `password`/`secret`/`token` keys as a second line of defence).
- better-auth's invitation path is left unbuilt, not disabled: its table exists and no endpoint is
  exposed.

## Consequences

- The platform admin must hand the temporary password to the person out of band.
- Owner-side user management (later, D1) reuses the same `users` services and routes; only
  permissions decide who may call them (`user:write`, `role:write`).
- When email delivery exists, invitations can replace temporary passwords for new accounts
  without changing the data model.
