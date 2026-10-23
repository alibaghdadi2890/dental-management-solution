# ADR-0055: Permissions come from roles and grants; two money tiers, visit scope, explicit discounts

- Status: Accepted (amends 0008, 0010, 0030)
- Date: 2026-10-21

## Context

The app is live and a clinic is testing it. Every dentist saw every visit, every balance and the
clinic's receivables, could discount and refund, and only a platform admin could change what a
role may do. The owner must decide who sees money and other dentists' work, from the clinic's own
Settings. Design: `docs/superpowers/specs/2026-10-21-financial-access-design.md` (D1–D25).

## Decision

1. **Deny by default; the owner widens.** A user's permissions are the union of their active
   roles and their **per-user grants** (`user_permission_grants`, additive only, no denies),
   resolved once per request into the context (ADR-0010) and carried by `GET /session`.
2. **The owner holds every permission by rule**: whoever holds the `owner` role gets the whole
   grantable catalog, so a permission added later reaches owners without a migration. The `owner`
   role cannot be edited. Other system roles are edited by the clinic and reset to their default;
   custom roles (`custom_<8 hex>` keys) are added and switched off, never deleted.
3. **Rules of widening** (`roles/domain/role-rules.ts`): every change needs `role:write`; an
   editor gives only what they hold — by role edit, grant or role assignment — and only an owner
   or a platform admin assigns `owner` (403 `role.cannot_grant`, naming the permission); no change
   may take the caller's own `role:write` or `user:write` (409 `role.self_lockout`, checked after
   the write, in its transaction); a held role is not switched off (409 `role.has_holders`).
   Managing someone's account — password, status, profile, roles, grants — needs everything they
   hold, and an owner's needs an owner or a platform admin (403 `role.cannot_manage`): otherwise a
   staff manager could reset the owner's password and act as them. Every change is audited with
   before and after.
4. **Two money tiers.** `payment:read` is one patient's account (balance, history, receipt,
   statement, a visit's money, the checkout queue). `finance:read` (new) is money across patients
   (Payments, aging, Outstanding, Unpaid visits, balances in lists, every export with money, the
   billed footer, money rows of the audit feed).
5. **Visit scope.** `visit:read` is the caller's own visits — they are the dentist (staff profile)
   or started it; `visit:read_all` (new) every visit. The rule is a pure function in
   `@dcm/contracts` (`canReadVisit`, `visitScopeOf`), applied by the API through
   `RequestContext.visitScope()` and by the SPA. A visit outside scope is not found (404), to
   reads and writes alike; starting a visit for a patient in another dentist's live visit is 409
   `visit.live_elsewhere`, never that visit. Patient records are not scoped (chart, diagnoses, plans, tooth history,
   files, last visit date, counts).
6. **A visit's money** shows only with `payment:read` or on the caller's own visit; without
   `payment:read` the visit summary answers its own figures, `handedOff: true`, and the SPA says
   "Handed to front desk for payment". The workspace's own visit keeps its prices: catalog prices
   are visible to everyone.
7. **Discounts are explicit**: `visit:discount` is needed for every change that lowers or sets a
   price — a line's base or discount, the visit discount, an amendment that changes it, the
   checkout discount (ADR-0030).
8. **Platform admins** hold everything in a tenant but `compensation:*` (ADR-0008).
9. **The audit feed** gets the caller's visits from `clinical` through a port (`AuditVisitScope`,
   registered by `clinical`: `audit` cannot depend on it) and leaves out rows about other visits;
   without `finance:read` it leaves out payment and ledger rows and the raw domain events.
10. **Migration 0050 is the last full rewrite of the system roles' grants.** From now on clinics
    edit their system roles, so a migration only adds permissions to them, as the default matrix
    says, and never removes one.

## Consequences

- `authorization` depends on `users` (the staff profile id). `clinical` registers the audit port.
- The default matrix changes for live tenants: dentists lose payments, discounts and other
  dentists' visits; front desk loses discounts; the assistant loses `payment:read`. The release
  note `docs/releases/2026-10-permissions.md` tells the clinic where to turn each one back on.
- Known edges: a tooth's history still shows each service's final price on other dentists' visits
  (it is patient record; it differs from the visible catalog price only by a line discount); a
  link to the patient's live visit from the tooth history may lead a scoped dentist to a 404.
