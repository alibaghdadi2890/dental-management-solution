# Financial access, visit scope, explicit discounts and clinic permissions — implementation plan

Spec: `docs/superpowers/specs/2026-10-21-financial-access-design.md` (D1–D25). No branch or commit
until the owner asks. Per task: run the affected tests and that package's typecheck. Task 17 runs
the full lint, typecheck, tests, build and Playwright, then one review.

Paths are under `apps/api/src/modules/` (API) or `apps/web/src/features/` (web) unless they start
with `apps/`, `packages/` or `docs/`. Integration specs are in `apps/api/test/integration/`. New
strings go to `apps/web/src/locales/{en,ar,fr}/` in the task that adds them. Add a `roles`
namespace and register it in `apps/web/src/types/i18next.d.ts`.

Because the app is live: the migration is additive, no permission key is renamed, and existing
API shapes only gain fields or become nullable where D15/D17 say so.

## 1. Contracts (D1–D3, D11, D15, D17, D22)

- `packages/contracts/src/permissions.ts`:
  - add `visit:read_all`, `finance:read`, `compensation:read`, `compensation:manage`;
  - add `GRANTABLE_PERMISSIONS` (everything except `platform:admin`).
- New `packages/contracts/src/capabilities.ts`:
  - `CAPABILITY_GROUPS`;
  - `CAPABILITIES` (permission → `{ group, labelKey, descriptionKey, implies }`), covering every
    grantable permission (enforced by a type-level check);
  - `closeImplied(set)` and `impliedBy(permission, set)` (what holds a permission on).
- New `packages/contracts/src/visit-scope.ts`:
  - `VisitActor`, `visitScopeOf(actor)`, `canReadVisit(actor, { dentistId, startedBy })`.
- `roles.ts`:
  - `roleSchema` gains `description`, `active`, `holders` and `updatedAt`;
  - new `createRoleSchema` (`name`, `description?`, `copyFrom?`), `updateRoleSchema` (`name?`,
    `description?`, `permissions?`, `active?`) and `setGrantsSchema` (`permissions`, `reason?`);
  - custom role keys `custom_<8 hex>`, which `roleKeySchema` already allows.
- `users.ts`: `staffUserSchema` gains `grants: Permission[] | null` and
  `effectivePermissions: Permission[] | null`.
- `session.ts`: `profile.id`.
- `visits.ts` and `visit-list.ts`: the money fields of `Visit`, `VisitListItem`, the summary's
  `billed` and the last-visit card's `total` become nullable (D15).
- `billing.ts`:
  - `visitFinancialSummarySchema` becomes a discriminated union on `handedOff`;
  - `checkoutQueueItemSchema`;
  - `patientListItem.balance` becomes nullable.
- Specs:
  - `capabilities.spec.ts`: every grantable permission has an entry; `implies` has no cycles and
    is closed under itself.
  - `visit-scope.spec.ts`: all, own by dentist, own by starter, no profile, none.

Done: contracts tests and typecheck pass. The API and web typecheck breaks are listed. Tasks 4–14
fix them.

## 2. Roles domain (D4, D5, D9)

- `roles/domain/system-roles.ts`: the D4 matrix. `system-roles.spec.ts` pins it role by role.
- New `roles/domain/role-rules.ts`. These are pure functions that take the editor's effective set,
  `isOwnerOrAdmin` and the before/after sets:
  - `assertCanGrant(editor, added)` → `role.cannot_grant` with `details.permission`
  - `assertCanAssign(editor, roles)` → `role.cannot_grant`; assigning `owner` needs owner or admin
  - `assertNoSelfLockout(callerBefore, callerAfter)` → `role.self_lockout`
  - `assertEditable(role)` → `role.owner_locked`
  - `assertDeactivatable(holders)` → `role.has_holders`
- `roles/domain/roles-errors.ts`: the four errors.
- `role-rules.spec.ts` covers every rule, including "owner holds all" and an `implies` closure that
  adds a permission the editor lacks (refused).

Done: domain tests pass.

## 3. Schema and migration 0050 (D7, D8, D24)

- `roles/persistence/schema.ts`:
  - `roles`: `description`, `active` (default true), `updatedBy`;
  - new `userPermissionGrants`: PK `(tenant_id, user_id, permission)`, `tenant_idx`, `user_idx`,
    `tenantIsolationPolicy()`.
- `clinical/persistence/schema.ts`: `visits_tenant_dentist_idx`.
- `pnpm --filter api db:generate`, then edit the SQL by hand:
  - the runtime grants on the new table, following `0000_runtime_grants.sql`;
  - the system-role rewrite: `DELETE FROM role_permissions USING roles WHERE system`, then
    `INSERT … SELECT … FROM roles JOIN (VALUES …) ON key` for the D4 matrix, following
    `0038_files.sql`;
  - comment: "Runs as the schema owner: every tenant's rows. The last full rewrite (ADR-0055)."
- New `apps/api/test/integration/migration-0050.int-spec.ts`:
  - migrate to 0049;
  - seed two tenants with the old matrix, a custom role and a user role;
  - run 0050 and assert the D4 matrix;
  - assert the custom data is untouched;
  - run it again and assert nothing changes.

  Follow whatever pattern the existing integration setup offers for migrating to a given step. If
  there is none, add a small helper in the test setup.

Done: migration applies on the local DB; the migration spec passes.

## 4. Roles and grants services and routes (D5, D7–D10, D20, D22)

- `roles/persistence/roles.repository.ts`:
  - `list()` with holder counts and active/description;
  - `create`, `update`, `setPermissions`;
  - `grantsOf(userIds)` and `replaceGrants`;
  - `permissionsOf(userId)`: active roles ∪ grants, or the whole grantable catalog when the user
    holds `owner`.
- `roles/application/roles.service.ts`:
  - `createRole` (with `copyFrom`), `updateRole`, `deactivateRole`, `reactivateRole`,
    `resetToDefault`, `setGrants`, `grantsFor`;
  - `assignRoles` now calls `assertCanAssign` and `assertNoSelfLockout`;
  - every write runs `closeImplied`, the D9 rules and a D10 audit record.
- `roles/http/roles.controller.ts`: `POST /roles`, `PATCH /roles/:id`,
  `POST /roles/:id/deactivate|reactivate|reset`.
- `users/http/users.controller.ts`:
  - `PUT /users/:id/grants` (`role:write`) → `UsersService.setGrants`, which delegates to roles;
  - `users.service.ts` `list`/`get` add `grants` and `effectivePermissions` only with `role:read`.
- `packages/contracts/src/audit.ts`: `AREA_OF_PREFIX` already maps `role` to the `users` area.
  Add the Activity sentences in `apps/web/src/features/audit/` (`changes.ts` or the sentence map)
  for the six actions, with en/ar/fr strings.
- `apps/api/test/integration/roles.int-spec.ts`:
  - create from Front desk plus `finance:read`; assign; deactivate while held gives 409 with the
    count;
  - reset; owner locked;
  - `role.cannot_grant` for a custom-role editor without `finance:read`, on a role edit, a grant
    and an assignment;
  - self-lockout through a role edit, a grant revoke and a role removal;
  - the audit before/after.
- `users.int-spec.ts`: grants and effective permissions on `GET /users` with and without
  `role:read`; the next request sees a new grant.
- `tenant-isolation-services.int-spec.ts`: grants and every new role route.

Done: roles, users and isolation suites pass.

## 5. Request context, authorization and session (D6, D11)

- `apps/api/src/platform/cls/request-context.ts`:
  - `staffProfileId` (set by authorization) and `visitScope()`, which wraps `visitScopeOf`;
  - in `hasPermission`, a platform admin is excluded from `compensation:*`;
  - `request-context.spec.ts` covers both.
- `authorization/application/authorization.service.ts`:
  - `resolveForRequest` also sets the profile id via `UsersService.profileIdOf`. This is a new edge
    `authorization → users`; add it to the module map in CLAUDE.md §4 in task 16;
  - `can(permission, resource?)` delegates to `canReadVisit` for `visit:read` with a resource.
- `users/application/session.service.ts`: `profile.id`. Extend `session.int-spec.ts`.

Done: unit tests and session integration test pass.

## 6. Clinical: visit scope and visit money (D12, D13, D15)

- `clinical/persistence/visit-search.sql.ts` and `visits.repository.ts`: a `scope` criterion
  (`dentist_id = $profile OR started_by = $user`) used by `search`, `aggregate`, `tabCounts` and
  `liveRefs`.
- `clinical/application/reads/visit-list.service.ts`: `search`, `summary` and `aggregate` pass
  `context.visitScope()`. `billed` is null without `finance:read`. `lastVisitFor` and
  `patientIdsSeenWithin` stay unscoped (D13).
- `clinical/application/visits/visits.service.ts`: `get` and `live` go through `canReadVisit`, and
  out of scope answers 404.
- `clinical/application/visits/visit-locks.ts`: `patientThenVisit` checks scope on the snapshot.
  That covers every visit write.
- Visit money (D15): the presenter or mapping that builds `Visit` and `VisitListItem`
  (`visit-mapping.ts`, `visit-list.service.ts`) nulls the money unless the caller holds
  `payment:read` or the visit is their own. `ChartService.lastVisit` does the same for `total`.
- `VisitFactsService.chargeFacts`, `numbersFor`, `refsFor` and `planWork` stay unscoped (D13), with
  a comment pointing at ADR-0055.
- New `clinical/application/audit-visit-scope.provider.ts` registers the D14 port implementation
  in `onModuleInit`. Create task 8's port file, `audit/application/audit-visit-scope.ts`, first. It returns `'all'`, or the ids from a repository query on the scope
  criterion.
- `apps/api/test/integration/visit-scope.int-spec.ts`:
  - dentist A vs dentist B: list, `tabCounts`, get (404), live, a write on B's visit (404);
  - A's patient chart and tooth history still show B's work;
  - an assistant sees all, with no money on others' visits;
  - front desk sees all, with money.

Done: clinical suites pass. Existing visit specs that relied on dentists seeing everything are
updated on purpose.

## 7. Clinical: discount gates (D2)

- `clinical/application/visits/visits.service.ts` `setDiscount`: `visit:discount`, and
  `visits.controller.ts` changes the route decorator to match.
- `clinical/application/records/service-charting.service.ts` `updateService`: requires
  `visit:discount` when `baseAmount` or `discountAmount` is present.
  `visit-records.controller.ts` keeps `visit:write` on the route, and the service decides.
- `clinical/domain/visit-amendment.ts`: return `discountChanged` on `AmendmentPlan`, with a test in
  `visit-amendment.spec.ts`. `VisitCorrectionsService.amend` requires `visit:discount` when it is
  true.
- `clinical/application/visits/visit-import.service.ts`: a non-zero visit discount requires
  `visit:discount`.
- `visit-corrections.int-spec.ts` and `visit-records.int-spec.ts`:
  - a dentist gets 403 on a discount PATCH, a line Base or Discount change, and an amendment that
    changes the discount;
  - an amendment that only adds a service succeeds;
  - the owner succeeds.

Done: suites pass.

## 8. Audit feed (D14)

- `audit/application/audit-visit-scope.ts`: the port (an injectable registry with
  `register(fn)`; it answers `'all'` until clinical registers). Export it from `audit/index.ts`.
- `audit/application/audit.service.ts` `list`: when the scope is not `'all'`, keep rows whose
  `visit_id` is null or in scope. Without `finance:read`, drop actions with the prefixes
  `payment.` and `ledger_entry.`. The filters go into `persistence/audit.repository.ts`.
- `audit.int-spec.ts`: the dentist's feed has no payment or ledger rows and no rows about B's
  visits; the owner's feed has all.

Done: audit suite passes.

## 9. Billing re-gating, checkout queue, hand-off summary, patients list (D16–D18, route map)

- Controllers (`billing.controller.ts`, `billing-payments.controller.ts`,
  `billing-visits.controller.ts`, `billing-patients.controller.ts`) and their services: apply the
  route map, keeping the route decorator and the service check equal. `familyStatement` gets its
  own `payment:read` check.
- New `checkoutQueue()` in `billing/application/visit-views.service.ts` with route
  `GET /billing/checkout-queue`. It returns today's unpaid visits (range today, completed or
  amended, still owing), each with `outstanding`, through `VisitListService.search` (scoped) and
  billing's own sums.
- `billing.service.ts` `visitSummary`: requires `visit:read` and scope (through `visitMoney`, which
  becomes scoped for this caller-facing use: add `visitMoneyFor(visitId)` that checks scope and
  leave `visitMoney` internal). It returns the reduced shape without `payment:read`.
- `billing/application/patient-views.service.ts`: `list` and `notSeenCount` need `patient:read`.
  `view=owing`, `sort=balance` and `owingCount` need `finance:read`. Balance is null without
  `finance:read`. `patient-export.service.ts` needs `finance:read`.
- New `apps/api/test/integration/billing-access.int-spec.ts`: one table-driven spec over the route
  map (dentist, front desk, owner; positive and negative); the checkout queue for front desk; the
  dentist's reduced summary for his visit and 404 for another's.
- Update `billing*.int-spec.ts` where the old matrix was assumed.

Done: billing suites pass.

## 10. Provisioning

- `provisioning` seeds through `seedSystemRoles`, which now uses D4. Assert in
  `provisioning.int-spec.ts` that a fresh tenant has the D4 grants.

Done: provisioning suite passes. API typecheck is clean.

## 11. SPA foundations (D3, D23)

- `features/auth/use-permission.ts`: add `useVisitScope()` and `useCanReadVisit(visit)`, from
  `session.profile.id` and the contracts rule.
- New `features/roles/capability-matrix.tsx`, the shared editor:
  - props `value`, `locked` (permission → caption, e.g. "from Front desk"), `readOnly`, `errors`
    (permission → message) and `onChange`;
  - group eyebrows in 11.5 px uppercase; one switch per permission with its label and
    description; the raw key in a Mono tooltip;
  - `implies` ticks dependencies and locks them.
  - Spec: implies tick and lock, locked caption, inline error, read-only.
- `components/ui/list.tsx` `ErrorState`: a `forbidden` variant with "You no longer have access to
  this" and a link to Today. `lib/api` errors with status 403 select it in the query error
  boundaries the screens already use.
- `locales/*/roles.json`: group, label and description strings for every capability, in en, ar and
  fr.

Done: web unit specs and typecheck pass for these files.

## 12. SPA money gating (D2, D15, D16, D18; prompt §1, §5)

- `shell/nav-items.ts`: Payments → `finance:read`; Today → `visit:read`.
- `features/patients/patients-page.tsx`, `patients-table.tsx`, `list-query.ts`: Balance column,
  Owes view, balance sort and export → `finance:read`. Not seen and Never → `patient:read` (still
  through `GET /billing/patients`).
- `features/clinical/visits-list/visits-page.tsx`, `visits-table.tsx`:
  - Unpaid tab, Balance cells, footer billed and export → `finance:read`;
  - Total column renders null as "—";
  - dentist filter chip → `visit:read_all`;
  - `visit-detail-panel.tsx` totals when not null; invoice → `payment:read`.
- `features/clinical/checkout-queue.ts`: use `GET /billing/checkout-queue`; gate `payment:read`.
  The Today page (`features/today/today-page.tsx`) renders the chair lane for `visit:read`, and the
  checkout lane for `payment:read`. `checkout-lane.tsx` shows "Awaiting payment · front desk".
- Record: `balance-card.tsx`, `needs-attention-card.tsx`, `overview-tab.tsx`,
  `quick-view-panel.tsx`, `record-search.ts` and `history-tab.tsx` keep `payment:read` (check each
  against D2). The last-visit card hides a null total. `patient-record-page.tsx` opens the
  post-visit summary for `visit:read` (no more toast).
- `features/audit/activity-page.tsx`: the Payments chip → `finance:read`.
- `features/clinical/dialogs/tooth-history-dialog.tsx` and other links to a visit: hide the
  action when `useCanReadVisit` is false.
- Update the affected specs (`today-page.spec.tsx`, patients and visits list specs).

Done: web specs and typecheck pass.

## 13. SPA discounts and hand-off (D2, D17)

- `features/clinical/workspace/tooth-panel/completed-section.tsx` (Base and Discount),
  `workspace/discount-control.tsx`, `financial-bar.tsx`, `flow/steps/complete-step.tsx`,
  `dialogs/visit-summary-dialog.tsx`:
  - editable only with `visit:write` + `visit:discount` on a live visit;
  - otherwise read-only, with the caption "Ask the owner" when the visit is writable but the
    discount permission is missing.
- `dialogs/post-visit-summary-dialog.tsx`, `visit-checkout.tsx`, `use-visit-checkout.ts`: render
  the `handedOff` shape with the total and "Handed to front desk for payment". The checkout
  discount Edit stays on `visit:discount`.
- Specs: `post-visit-summary-dialog.spec.tsx` (both shapes), a read-only discount spec.

Done: web specs pass.

## 14. SPA Settings, Staff and Access (D19, D20, D22)

- Move `features/platform/tenant-detail/{users-tab,user-panel,user-form,reset-password-panel}.tsx`
  to `features/users/staff/`:
  - optional `tenantId` prop;
  - query keys `userKeys.staff` (and `platformKeys` invalidation only when `tenantId` is set);
  - strings move from `admin` to `users`.

  The admin `tenant-detail-page.tsx` imports them from the new place.

- `user-panel.tsx` gets Profile and Access tabs. Access shows:
  - the role chips (moved from Profile);
  - "Additional permissions" as a `CapabilityMatrix`, with role-granted permissions locked as
    "from {Role}";
  - one dirty state and Save: `PATCH /users/:id` with `roleKeys` when they changed, then
    `PUT /users/:id/grants`;
  - inline `role.cannot_grant` on the switch, and `role.self_lockout` in the panel error.

  New `features/users/users-api.ts` `setGrants`.

- `routes/_app/settings.tsx`: tabs Dental chart, Staff and Roles (URL `?tab=`), in the tenant
  detail style. `shell/nav-items.ts` Settings shows with `tenant:write || user:write || role:read`.
- Specs: Settings tab gating; Access tab (locked from role, implies, save calls, inline 403).

Done: web specs pass. The admin portal Users tab works as before, plus the Access tab.

## 15. SPA Roles tab (D21)

- New `features/roles/`:
  - `roles-api.ts` (list, create, update, deactivate, reactivate, reset);
  - `roles-tab.tsx`: the list on the left and the matrix with `SaveBar` on the right;
  - Reset to default with `useConfirm`;
  - owner read-only note;
  - Active switch for custom roles, with inline `role.has_holders` and the count;
  - `new-role-panel.tsx` (`RightPanel`: name, description, Start from).
- `components/unsaved-changes-guard.tsx` guards switching roles while dirty.
- Spec: one-change save bar, discard, owner read-only, new role from a copy, deactivate refused.

Done: web specs pass.

## 16. Docs (D25)

- `docs/adr/0055-permissions-from-roles-and-grants.md` and the index in `docs/adr/README.md`.
- `CLAUDE.md`:
  - §4 module map (`authorization` depends on users; audit's visit-scope port);
  - §6 (two money tiers, visit scope, explicit discounts, owner and admin rules, the add-only rule
    for system roles).
- `docs/modules/{roles,authorization,users,clinical,billing,audit}.md`: permission sections and
  matrices.
- `docs/releases/2026-10-permissions.md` (en), for the testing client.

## 17. Playwright, full verification, review

- `apps/web/e2e/permissions.spec.ts`:
  - the dentist → front desk hand-off: the dentist completes and sees "Handed to front desk"; front
    desk sees the visit in the queue, records the payment, and has no discount edit;
  - Settings › Roles: Front desk gets _Apply discounts_, saved with one change; a custom
    "Clinic manager" role;
  - Settings › Staff › Access: grant all visits and patient balances to the dentist; implies.
- Update the existing e2e specs that used a dentist for payments or discounts (`checkout.spec.ts`,
  `payments.spec.ts`, `visit.spec.ts`, and the fixtures in `global-setup.ts`).
- Full `pnpm lint`, `pnpm typecheck`, `pnpm test`, the integration suites, `pnpm build` and
  Playwright.
- One code review over the working tree (`git diff`, plus untracked files). Fix the findings, then
  report and ask about committing (the three-commit shape: api, web, docs).

## 18. Platform default roles (D26–D31, ADR-0056)

- Contracts: `roleTemplateSchema` (`roleSchema` without `holders`).
- `roles/persistence/schema.ts`: `roleTemplates`, `roleTemplatePermissions` (no RLS). Migration
  0051: the tables, the seed of the three system templates, `REVOKE INSERT, UPDATE, DELETE … FROM
dcm_app`.
- `roles/persistence/role-templates.repository.ts` (every method takes `tx`).
- `roles/application/role-templates.service.ts`: list, create (`copyFrom` a template key),
  update, deactivate, reactivate through `withoutTenant()`; `forProvisioning(tx)`; pino log.
- `RolesService.seedSystemRoles` and `resetToDefault` read the templates (owner from code).
- `roles/http/platform-role-templates.controller.ts` (`platform:admin`).
- Integration: a template change reaches a new clinic, not an existing one, and the existing
  one's reset; an extra template becomes a custom role in a new clinic, an inactive one doesn't;
  403 for a clinic user; the runtime role cannot write the tables.
- Web: `RolesTab` on a source (clinic or templates); the tenant page's Roles tab; `/admin/roles`
  (Default roles) in the platform sidebar; strings in en/ar/fr; a spec for the templates screen.
- Docs: ADR-0056, `docs/modules/roles.md`, CLAUDE.md §4/§6, the release note.
