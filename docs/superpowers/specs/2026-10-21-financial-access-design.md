# Financial access, visit scope, explicit discounts and clinic permissions — design

Date: 2026-10-21. Feature 13a. Modules: `roles`, `authorization`, `users`, `clinical`, `billing`,
`audit`, `provisioning`, `contracts`, the SPA. ADR-0055. Migration 0050.

## Why

The app is deployed and a client is testing it. Today every dentist sees every visit, every
balance and the clinic's receivables, can discount and refund, and only a platform admin can
change what a role may do. The owner must decide who sees money and other dentists' work, and
must manage it from the clinic's own Settings.

**The rule:** deny by default, and the owner is the only person who widens anything. A new dentist
can treat patients, see his own visits, quote from the catalog and complete a visit. He cannot see
a balance, a payment, another dentist's visit, an editable discount or price, or receivables.
Everything else is a switch the owner turns on, per role or per person. Each switch is one
audited row.

**Constraints of a live deployment:** the migration is additive and keeps all data. No permission
key is renamed. Sessions keep working, and permission changes apply on the next request
(ADR-0010).

## Decisions

### Permissions

- **D1 — New keys** in `packages/contracts/src/permissions.ts`: `visit:read_all`, `finance:read`,
  `compensation:read` and `compensation:manage`. The last two are reserved for 13b: roles grant
  them, but nothing enforces them yet.
- **D2 — Narrowed meanings. No key is renamed.**
  - `visit:read`: **your own visits**. The caller's staff profile is the visit's dentist, or the
    caller started the visit.
  - `visit:read_all`: every visit in the tenant.
  - `payment:read`: **one patient's account**. Balance, outstanding, open charges, payment
    history, receipt, statement, family statement, the checkout queue, and the money of a visit.
  - `finance:read`: **money across patients**. The Payments screen (KPIs, aging, Outstanding,
    Transactions), every CSV export with money, the Unpaid visits view and its summary, the
    Owes-balance view and its count, balance sort, the patients list's Balance column, the
    Visits list's billed footer, and money rows in the audit feed.
  - `visit:discount`: **every change that lowers or sets a price**. That covers a line's Base and
    Discount, the visit-level discount, an amendment that changes the discount, and the checkout
    discount. (Imports carry no discount, so they need nothing more than `import:run`.)
- **D3 — The capability catalog** (`packages/contracts/src/capabilities.ts`).
  - Each permission has a `group`: Patients · Visits · Clinical · Money · Catalog · Files ·
    Staff & roles · Compensation · Activity · Clinic.
  - Each has a label key and a description key, in the `roles` i18n namespace for en, ar and fr.
  - Each has `implies`:
    - `visit:read_all ⇒ visit:read`
    - `visit:write ⇒ visit:read`
    - `payment:write ⇒ payment:read`
    - `payment:refund ⇒ payment:read`
    - `finance:read ⇒ payment:read`
    - `compensation:manage ⇒ compensation:read`
    - `user:write ⇒ user:read`
    - `role:write ⇒ role:read`
  - `closeImplied(set)` is a pure helper that adds what is implied. The API applies it to every
    write, and the SPA ticks implied permissions and locks them.
  - `platform:admin` is not in the catalog of grantable permissions.
- **D4 — The new default matrix** (`roles/domain/system-roles.ts`, pinned by test):

  | Permission                                                                                                           | owner | dentist | assistant | frontdesk |
  | -------------------------------------------------------------------------------------------------------------------- | ----- | ------- | --------- | --------- |
  | `tenant:read`, `user:read`, `catalog:read`, `patient:read`, `patient:write`, `visit:read`, `file:read`, `file:write` | ✓     | ✓       | ✓         | ✓         |
  | `visit:read_all`                                                                                                     | ✓     | –       | ✓         | ✓         |
  | `visit:write`                                                                                                        | ✓     | ✓       | ✓         | –         |
  | `visit:void`, `visit:amend`, `chart:write`, `file:archive`, `audit:read`, `compensation:read`                        | ✓     | ✓       | –         | –         |
  | `visit:discount`                                                                                                     | ✓     | –       | –         | –         |
  | `payment:read`, `payment:write`                                                                                      | ✓     | –       | –         | ✓         |
  | `payment:refund`, `finance:read`, `compensation:manage`                                                              | ✓     | –       | –         | –         |
  | `tenant:write`, `user:write`, `role:read`, `role:write`, `catalog:write`, `import:run`                               | ✓     | –       | –         | –         |

  What each role loses:
  - Dentist: `payment:*`, `visit:discount` and all visits.
  - Front desk: `visit:discount`.
  - Assistant: `payment:read` (confirmed).

- **D5 — The owner holds everything by rule.** If a user holds the `owner` role,
  `permissionsForUser` returns the whole grantable catalog. New permissions therefore reach owners
  with no migration. The `owner` role's rows are still written, so the matrix can display them.
  The owner role cannot be edited.
- **D6 — Platform admins** hold everything inside a tenant except `compensation:*`. This is
  enforced in `RequestContext.hasPermission`. They are unchanged otherwise (ADR-0008).

### Roles and grants

- **D7 — Custom roles.** `roles` gains `description` (nullable), `active` (default true) and
  `updated_by`.
  - A custom role's key is generated as `custom_<8 hex>`, because names may be Arabic.
  - Custom roles are deactivated, never deleted. A deactivated role grants nothing, cannot be
    assigned, and is listed greyed out.
  - System roles other than `owner` can be edited by the clinic, and **Reset to default** restores
    D4.
- **D8 — Per-user grants.** New table `user_permission_grants`:
  - Columns: `tenant_id`, `user_id` (the auth user id), `permission` (text, filtered through the
    catalog on read), `granted_by`, `reason?`, and timestamps.
  - Primary key `(tenant_id, user_id, permission)`. RLS. A revoked grant is hard-deleted.
  - Grants are additive only; there are no denies.
  - `permissionsForUser` = the union of the user's active roles and their grants. It is resolved
    once per request (ADR-0010). `GET /session` carries the result as it does today.
- **D9 — Guards.** These are pure rules in `roles/domain/role-rules.ts`, run inside the services:
  - Every role change, grant change and role assignment needs `role:write`.
  - **You can only give what you hold.** The editor must hold every permission they add, whether
    to a role, as a grant, or through a role they assign. Otherwise the change fails with 403
    `role.cannot_grant`, and `details.permission` names the permission. Owners and platform admins
    hold everything.
  - Only an owner or a platform admin can assign the `owner` role.
  - **No self-lockout.** A change that would remove the caller's own `role:write` or `user:write`
    fails with 409 `role.self_lockout`. That covers editing their role, revoking their grant, or
    removing their role.
  - `owner` cannot be edited: 409 `role.owner_locked`.
  - A role with holders cannot be deactivated: 409 `role.has_holders`, with `details.holders`
    giving the count.
  - The last-owner rule is unchanged.
- **D10 — Audit actions**, each with an Activity sentence in the `users` area:
  - `role.create`, `role.update` (the permission set before and after), `role.deactivate`,
    `role.reactivate` and `role.reset`
  - `user.grants_update` (before and after)

### Visit scope

- **D11 — The rule is a pure function in `@dcm/contracts`** (`visit-scope.ts`), following CLAUDE.md
  §6's rule for row checks the SPA also needs:
  - `visitScopeOf(actor)` returns `'all'`, or `{ profileId, userId }`, or `'none'`.
  - `canReadVisit(actor, { dentistId, startedBy })`.
  - `actor` = `{ permissions, userId, profileId }`.

  `authorization` resolves the caller's staff profile id into the request context alongside the
  permissions (an extension of ADR-0010; `RequestContext.staffProfileId`).
  `AuthorizationService.can(permission, resource?)` delegates to the rule.
  `RequestContext.visitScope()` is the one entry point the services use, so `clinical` gets no new
  module edge. `GET /session` adds `profile.id`.

- **D12 — Where scope applies.** It applies to every visit read and to every route that loads a
  visit by id, reads and writes alike. Out of scope answers 404 `visit.not_found`.
  - **Clinical:** `VisitListService.search`, `aggregate`, `summary` (including `tabCounts`),
    `VisitsService.get` and `live`, and `VisitLocks.patientThenVisit`. That last one covers every
    write: services, worklist, discount, complete, checkout, amend, void.
  - **Billing:** the visit summary, and the visit views (which go through `search`).
- **D13 — What scope does not apply to (F8).** These are internal or patient-level, and stay
  visible to anyone with `patient:read`:
  - `chargeFacts`, which the in-transaction charge subscriber uses
  - `numbersFor` and `refsFor`: visit labels on accounts, statements and files
  - `planWork`
  - `lastVisitFor`, `patientIdsSeenWithin` and the visit count
  - the chart, diagnoses, plans, tooth history and files

  The Overview's last-visit card is clinical record, so it is shown. Its `total` follows D15.

- **D14 — The audit feed.**
  - `audit` declares a port, `AuditVisitScope`, with `visitIdsInScope(): Promise<string[] | 'all'>`.
    `clinical` registers the implementation when its module starts. `clinical` already depends on
    `audit`, so this direction is allowed.
  - `AuditService.list` drops rows whose `visit_id` is outside the caller's scope.
  - Without `finance:read`, it also drops rows whose action starts with `payment.` or
    `ledger_entry.`.
  - The SPA hides the Payments area chip without `finance:read`.

### Money of a visit and the hand-off

- **D15 — What a visit's money is visible to.** In `VisitListItem` (the list, the detail panel,
  the record's history) and the last-visit card, `subtotal`, `discountAmount`, `total`,
  `services[].final` and the discount become nullable. The API fills them only for:
  - a caller who holds `payment:read`, or
  - the caller's own visit (the dentist or the starter).

  The workspace's own `Visit` keeps its prices: whoever works in a visit sees what it costs, and
  catalog prices are visible to every role (F10).

  The billed footer of `GET /visits/summary` needs `finance:read` and is null otherwise.

- **D16 — The checkout queue.** New route `GET /billing/checkout-queue` (`payment:read`, visits in
  the caller's scope). It returns today's completed or amended visits that still owe, each with
  its amount and no sum. The Today board's checkout lane and the header pill use it.
  `GET /billing/visits/balances?visitIds` moves to `payment:read`.
- **D17 — The visit summary in two shapes.** `GET /billing/visits/:id/summary` needs `visit:read`
  and applies scope.
  - With `payment:read`, it returns the full `VisitFinancialSummary`, with `handedOff: false`.
  - Without it, it returns `{ visitId, currency, visit: { total, paid, outstanding }, handedOff: true }`.

  This is a discriminated union on `handedOff` in contracts. The SPA shows "Handed to front desk
  for payment" in place of _Record payment_, in the post-visit summary (Steps and All) and on the
  record. The Today board's checkout card shows "Awaiting payment · front desk".

- **D18 — The patients list.**
  - `GET /billing/patients` and `/not-seen-count` need `patient:read`. Not-seen needs data from
    `clinical`, which the `patients` module cannot reach.
  - Without `finance:read`, `balance` is null, and the following answer 403: `view=owing`,
    `sort=balance`, `/owing-count` and `/export`.
  - The SPA keeps choosing `GET /patients` or `GET /billing/patients` by view, as it does today.

### Billing route map

| Routes                                                                                                                                                                                                   | Access (route and service)   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `GET /billing/payments`, `/payments/export`, `/aging`, `/outstanding`, `/patients/owing-count`, `/patients/export`, `/balances?patientIds`, `/visits/unpaid`, `/visits/unpaid/summary`, `/visits/export` | `finance:read`               |
| `GET /billing/patients`, `/patients/not-seen-count`                                                                                                                                                      | `patient:read` (D18)         |
| `GET /billing/checkout-queue`                                                                                                                                                                            | `payment:read`, scoped (D16) |
| `GET /billing/visits/balances?visitIds`, `/patients/:id/balance`, `/:id/account`, `/:id/statement`, `/payments/:id/receipt`, `/contacts/:id/family`, `/family/statement`                                 | `payment:read`               |
| `GET /billing/visits/:id/summary`                                                                                                                                                                        | `visit:read`, scoped (D17)   |
| `POST /billing/payments`, `/payments/preview`, `/payments/:id/release`, `/opening-balances`                                                                                                              | `payment:write`              |
| `POST /billing/payments/:id/refund`, `/void`, `/patients/:id/adjustments`                                                                                                                                | `payment:refund`             |

`VisitChargeSubscriber` stays ungated (ADR-0024). `familyStatement` gets its own check.
`/balances?patientIds` moves to `finance:read` because only the patients list uses it, and the
Balance column needs `finance:read`.

### Settings, Staff and Roles (SPA)

- **D19 — Settings** becomes one screen with tabs, using the tenant detail page's tab style:
  - **Dental chart** (`tenant:write`)
  - **Staff** (`user:write`)
  - **Roles** (`role:read`)

  The nav item shows if the caller has any of the three. A tab the caller lacks is not shown.

- **D20 — Staff.** Settings › Staff mounts the admin portal's Users table, user panel and
  reset-password panel as they are, on the clinic's own tenant: the API ignores `X-Tenant-Id` for
  clinic users, so no move or second API layer is needed on a live app.
  - The panel gets tabs **Profile · Access**.
  - **Access** needs `role:read` to view and `role:write` to edit. It shows:
    - the role chips;
    - **Additional permissions**, as the capability matrix. A permission a role already grants is
      shown on and disabled, with the caption "from {Role}". A 403 `role.cannot_grant` is shown
      inline on that switch.
  - Saving the Access tab calls `PATCH /users/:id` (`roleKeys`) and `PUT /users/:id/grants`.
  - The admin portal's Users tab gets the same Access tab.
- **D21 — Roles.**
  - Left side: the list of roles, showing the name, a System or Custom pill, the holder count, an
    Active switch for custom roles, and **New role**.
  - Right side: the capability matrix with the shared `SaveBar`, plus **Reset to default** for
    system roles (with a confirm dialog). Custom roles show their name and description fields.
  - The `owner` role is read-only: "The owner role always has every permission."
  - **New role** opens a right panel with: name\*, description, and _Start from_ (copy a role).
- **D22 — `GET /users` and `GET /users/:id`** include `grants` and `effectivePermissions` only for
  a caller with `role:read`. Otherwise both are null.
- **D23 — Lost access.** A 403 `forbidden` on an open screen shows `ErrorState` with "You no
  longer have access to this" and a link to Today. Nothing retries silently.

### Migration and docs

- **D24 — Migration 0050**, run as the schema owner like 0026 and 0038.
  - Adds the role columns, `user_permission_grants` (RLS, indexes, runtime grants) and
    `visits_tenant_dentist_idx`.
  - Rewrites the system roles' grants in every tenant to D4: deletes the system roles'
    `role_permissions`, then inserts the matrix. It is idempotent.
  - Custom data is untouched.
  - **This is the last full rewrite.** From now on a migration only adds new permissions to system
    roles, as the matrix says, and never removes any.
- **D25 — Documentation:**
  - ADR-0055: permissions from roles and grants; two money tiers; visit scope; explicit
    discounts; owner and platform-admin rules; the add-only rule.
  - CLAUDE.md §6.
  - `docs/modules/{roles,authorization,users,clinical,billing,audit}.md`.
  - `docs/releases/2026-10-permissions.md`, in English, for the testing client: what dentists,
    assistants and front desk no longer see, and where the owner turns each thing back on.

### Platform default roles (added 2026-10-21, ADR-0056)

Some clinics will not manage access themselves: the platform admin does it for them, per clinic
and as the platform's defaults.

- **D26 — Per clinic.** The admin portal's tenant page gets a **Roles** tab: the same screen as
  Settings › Roles, acting on that clinic (the API already grants a platform admin every
  permission in a tenant). The clinic's owner can still edit too. Changes are audited in the
  clinic as the platform admin.
- **D27 — Platform defaults.** The default roles move from a code constant to two global tables
  owned by `roles`: `role_templates` (`key`, `name`, `description`, `system`, `active`,
  `updated_by`) and `role_template_permissions`. No `tenant_id` and no RLS: every tenant
  transaction reads them (provisioning, reset); only `withoutTenant()` writes them, and migration
  0051 revokes writes from the runtime role. It seeds the three system templates (Dentist,
  Assistant, Front desk) from the matrix of D4. `owner` is not a template: it holds everything.
- **D28 — What a default change does.** New clinics are created from the templates. Existing
  clinics are never changed; their **Reset to default** resets a system role to its template.
- **D29 — Extra default roles.** The platform admin adds templates of their own (custom keys
  `custom_<8 hex>`); a new one starts switched off, so a default being set up never reaches a new
  clinic half done. They are edited and switched on and off, never deleted. Every new clinic gets each active one as a
  custom role (same key, name, description and permissions). Existing clinics don't.
- **D30 — Routes and screen.** `GET/POST /platform/role-templates`, `PATCH /platform/role-templates/:id`,
  `POST /platform/role-templates/:id/deactivate|reactivate` (`platform:admin`). A system
  template keeps its name; its permissions change. Every change is closed under `implies`. With no
  tenant, changes are not in a clinic's audit log; they are logged (pino) with before and after.
  The admin portal gets **Default roles** in its sidebar: the Roles screen on the templates (no
  holder counts, no reset).
- **D31 — Add-only rule.** A migration that adds a permission to the default matrix adds it to
  the system templates as well as to the tenants' system roles.

### Platform Activity (added 2026-10-23, ADR-0057)

- **D32** — Platform admins see every clinic's Activity in the admin portal (**Activity**), with
  the clinic as a column and a filter (and the area, a person of the chosen clinic, the date):
  `GET /platform/audit`, read through `withoutTenant()`, names looked up in each row's clinic.

## Out of scope

- Compensation (13b)
- Denies
- Deleting roles
- Hiding catalog prices
- Scoping patient records by dentist
- Invitations and MFA
- Per-branch permissions
- The AI toolbox

## Testing

Following the lean process.

- **Unit tests:**
  - role rules, `closeImplied`, `visitScopeOf` and `canReadVisit`
  - the matrix pinned per role
  - the platform-admin exclusion
  - the amendment's discount-changed check
- **Integration tests:**
  - migration 0050 run on the old matrix (custom data untouched)
  - roles and grants routes, guards and audit
  - visit scope (list, get, live, writes, summary, audit feed)
  - one spec for the billing route map, positive and negative
  - discount gates
  - tenant isolation for `user_permission_grants` and the role routes
- **SPA specs** where there is logic:
  - capability matrix (implies, "from Role", inline 403)
  - Settings tab gating
  - hand-off summary
  - discount fields read-only
- **Playwright:**
  - dentist → front desk hand-off
  - Settings › Roles
  - Settings › Staff › Access
- Existing suites stay green, or are rewritten on purpose where roles changed.
