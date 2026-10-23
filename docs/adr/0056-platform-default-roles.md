# ADR-0056: The platform manages default roles and, for a clinic, its roles

- Status: Accepted (amends 0055)
- Date: 2026-10-21

## Context

ADR-0055 lets a clinic's owner decide who may do what. Some owners will not want to: they expect
the platform to set access up for them, both as the defaults every clinic starts with and for
their clinic in particular. The defaults were a code constant (`SYSTEM_ROLES`), so only a release
could change them. Design: `docs/superpowers/specs/2026-10-21-financial-access-design.md`
(D26–D31).

## Decision

1. **Per clinic**, the admin portal's tenant page has a **Roles** tab, the same screen as
   Settings › Roles. A platform admin already holds every permission in a tenant (ADR-0008); the
   owner can still edit too. Changes are audited in the clinic, as the platform admin.
2. **The defaults are data**: `role_templates` and `role_template_permissions`, owned by `roles`.
   They are global (no `tenant_id`, no RLS): every tenant transaction reads them, only
   `withoutTenant()` writes them, and the runtime role has no write grant. Migration 0051 seeds the
   three system templates (Dentist, Assistant, Front desk) from ADR-0055's matrix. `owner` is no
   template.
3. **A default change reaches new clinics only.** Provisioning creates a clinic's system roles
   from the system templates and every active extra template as a custom role. An existing
   clinic never changes; its **Reset to default** restores a system role to the template.
4. **Extra default roles** (custom keys) are added by the platform admin, start switched off, and
   are edited and switched on and off, never deleted.
5. A system template keeps its name. Every change is closed under `implies`. With no tenant, the
   changes are logged (pino, before and after), not written to a clinic's audit log.
6. ADR-0055's add-only rule covers the templates: a migration that adds a permission to the
   default matrix adds it to the system templates and to the tenants' system roles.

## Consequences

- `SYSTEM_ROLES` remains the code's statement of the original matrix: the seed of 0051, the
  fallback if a system template is missing, and what the matrix test pins.
- Tests must not change the global templates (test files share one database): provisioning's
  read of the templates is stubbed per test app instead.
