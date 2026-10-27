# ADR-0060: Compensation is managed by the clinic only

- Status: Accepted
- Date: 2026-10-25

## Context

How a clinic pays its dentists is the owner's business. Feature 13a reserved `compensation:read`
and `compensation:manage`, and kept both from platform admins (ADR-0055). Dentists should read
their own statements and nothing else.

## Decision

1. `compensation:manage` (owner by default) covers agreements, adjustments, payouts,
   closing and reopening, every statement, the report and the exports.
   `compensation:read` (dentist by default) covers the caller's own statement only.
2. The self-only rule is a pure `canReadStatement(actor, profileId)` in `@dcm/contracts`, the
   pattern of `canReadVisit`. The actor's profile is the one `authorization` resolves into CLS.
   `AuthorizationService.can('compensation:read', { profileId })` delegates to it. `compensation`
   applies it without depending on `authorization`.
3. A dentist sees a month only when the latest agreement in force in it has
   `statement_visible_to_dentist`. Otherwise `/compensation/me/statement` answers 404, and the
   month is not listed by `/me/months`, which drives the **My statement** nav item.
4. A platform admin acting in a clinic holds no `compensation:*`. There is no platform screen
   for it.
5. **Activity.** `audit` hides compensation rows from anyone without `compensation:manage`: the
   rows whose resource type is `compensation_*`, and the raw events in `COMPENSATION_EVENTS`.
   The dentist doesn't see their own either; they have the statement. `GET /platform/audit` always
   hides them.

## Consequences

- A clinic that wants a dentist to see nothing turns the switch off on their agreement, or
  removes `compensation:read` from the Dentist role in Settings › Roles.
