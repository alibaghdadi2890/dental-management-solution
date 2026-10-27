# ADR-0061: An Admin system role with every permission, below the owner

- Status: Accepted (amends 0055, 0056)
- Date: 2026-10-27

## Context

A clinic wants someone who runs the clinic with full access: every record, every setting, staff,
roles, money and compensation. That person may be the owner or someone else, like a manager the
owner hires. Today the only role with every permission is `owner`. Giving `owner` to a manager
also gives them the account itself: they could manage or remove the real owner, and no one can
narrow the `owner` role.

## Decision

1. **A fifth system role, `admin`** ("Admin"), is seeded in every clinic next to `owner`,
   `dentist`, `assistant` and `frontdesk`, and given to no one. The clinic assigns it to anyone,
   the owner included, as an addition to their other roles.
2. **It starts with every grantable permission, as data.** `compensation:*` is included. The
   clinic, or a platform admin from the tenant page, may narrow the role like any other system
   role. **Reset to default** gives every permission back. Its platform default is a system
   template (`role_templates`, ADR-0056), so the platform can change what new clinics start with.
3. **It stays below the owner.** Nothing in ADR-0055's rules of widening changes. An admin holds
   every permission but is not `holdsAll`. So an admin manages, widens and assigns anyone and any
   role, other admins included. But an admin never manages an owner, never gives `owner` and never
   takes it away (403 `role.cannot_manage` / `role.cannot_grant`). The self-lockout rule applies
   to an admin as to anyone.
4. Migration `0054_admin_role` adds the role, with every permission, to every existing clinic,
   and adds the system template. It only adds and is idempotent.
5. **The add-only rule now names the admin.** A migration that adds a permission to the catalog
   also adds it to the `admin` system template and to every clinic's `admin` role. Otherwise the
   admin would quietly fall behind "every permission". The owner needs nothing: it holds
   everything by rule.

## Consequences

- An owner who would like to step back gives Admin to a manager and keeps `owner` for themselves.
  The manager can run the clinic but cannot take it over.
- A clinic that wants a narrower admin edits the role. It is still called Admin, so a clinic that
  narrows it a lot would do better with a custom role.
- `SYSTEM_ROLE_KEYS` and `SYSTEM_ROLES` list `admin` second, so every role list shows it under
  Owner.
