# `audit` module

**Status:** implemented — append-only log, generic event subscriber, query API; the context
columns and the Activity feed (feature 7, ADR-0037).

## Purpose

Append-only audit log: who/what/when/tenant/before/after for every mutation, fed by explicit
entries from application services (inside their transaction) and by a single generic subscriber
to all domain events. Agent tool calls will be recorded with `actor_kind = 'agent'`. Owners and
dentists read it on the **Activity** screen.

## Owns

`audit_log` — `id, tenant_id, actor_user_id, actor_kind, actor_platform_admin, action,
resource_type, resource_id, before, after, reason, request_id, occurred_at, patient_id, visit_id,
area` (+ timestamps). Tenant RLS. `dcm_app` and `dcm_admin` have INSERT/SELECT only (UPDATE,
DELETE and TRUNCATE are revoked in the migration). Snapshots pass through `redactSecrets()`;
credentials are never stored.

- `patient_id`, `visit_id`: what the row is about, when it is about a patient or a visit. No
  foreign keys (other modules own those tables).
- `area`: the Activity area of the action, or null for a row the screen leaves out.
- Indexes: `(tenant_id, occurred_at desc, id desc)`, `(tenant_id, resource_type, resource_id)`,
  `(tenant_id, area, occurred_at desc, id desc) where area is not null` (the feed) and
  `(tenant_id, patient_id, occurred_at desc) where patient_id is not null`.
- Rows from before feature 7 were backfilled by migration 0035.

## Public API (`index.ts`)

- `AuditModule`
- `AuditService.record({ action, resourceType, resourceId, before?, after?, reason?, patientId?,
visitId?, hidden? })` — joins the caller's open `TenantDb` transaction and stamps actor,
  platform-admin flag and request id from CLS. Requires a tenant context. Actions are
  `<resource>.<verb>` (e.g. `branch.update`).
- `AuditService.about({ patientId?, visitId? }, work)` — runs `work` as being about a patient, a
  visit or both: every entry recorded inside it carries them unless it names its own. A service
  calls it once, where it locks the visit or the patient.
- `AuditService.list(query)` — newest first, opaque `(occurred_at, id)` cursor.

What a row is about, most explicit first (`domain/audit-subject.ts`): what `record()` was given,
the surrounding `about()`, the resource itself when it is a patient or a visit, then the
`patientId` / `visitId` its `after` or `before` snapshot carries.

## Vocabulary

An action is `<resource>.<verb>`; its first segment decides its area (`areaOfAction` in
`packages/contracts/src/audit.ts`):

| Area       | Action prefixes                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `patients` | `patient.`                                                                                                                                          |
| `contacts` | `contact.`                                                                                                                                          |
| `visits`   | `visit.`, `visit_service.`, `diagnosis_record.`, `treatment_plan.`, `plan_group.`, `tooth_presence.`, `clinical.` (and the retired `tooth_status.`) |
| `payments` | `payment.`, `ledger_entry.`                                                                                                                         |
| `catalog`  | `catalog.`                                                                                                                                          |
| `users`    | `user.`, `role.`                                                                                                                                    |
| `settings` | `tenant.`, `branch.`, `room.`                                                                                                                       |
| `files`    | `file.` (feature 8: `file.upload`, `file.update`, `file.archive`, `file.restore`, `file.repoint`)                                                   |

A row has **no area**, and so is never on the Activity screen, when it is a stored domain event
(`resource_type = 'event'`; an event name has no `resource.verb` shape) or when its writer marks
it `hidden`: the ledger entry of a payment, a refund, a void or a visit change only shadows that
action's own row. Opening balances and adjustments are actions of their own and are shown.

A new action needs a sentence in `apps/web/src/locales/*/activity.json` (`actions.<action>`);
`features/audit/sentence.spec.ts` lists the actions the API emits and fails when one has none. A
new prefix needs an area in `AREA_OF_PREFIX`.

## The Activity screen (feature 7, H7)

Route `/activity`, under ADMIN between Catalog and Settings, for `audit:read` (owner, dentist; a
platform admin acting in the clinic). `apps/web/src/features/audit/`:

- **Filters**, kept in the URL: _Area_ chips, _Person_ (the clinic's staff, plus "Platform
  admin"), _Date_ (Today / 7 / 30 / 90 days / All, default 30; from the clinic's midnight), and a
  search box. "View all activity" on the patient quick view and the visit detail trail opens it
  narrowed to that patient or visit (`?patient=` / `?visit=`).
- **Search** is resolved by the SPA through the lists it already has: `P-12`, `V-45` and `RCT-3`
  to that patient, visit or receipt; other text to a staff member whose name contains it (what
  they did), else to the first patient it finds (what was done about them). The feed is then
  narrowed to that record; it has no text search of its own.
- **Rows**: When, Who (with a "Platform admin" badge), What — a sentence built by `sentence.ts`
  from the action, the snapshots and the names looked up per page (`GET /patients/names`,
  `GET /visits/numbers`, the staff list), with the record it names as a link — and the Reason.
  An action without a sentence reads as its code made readable ("Treatment plan · reprice").
- **Expanded row**: the changed fields only, as before → after pairs (`changes.ts`), never JSON;
  "No field changes recorded" when there is nothing to show.
- Cursor paging behind "Load more".

## HTTP

| Route        | Access                                                                                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /audit` | `audit:read` — `?resourceType=&resourceId=&cursor=&limit=` (a record's timeline), and the feed: `feed=true` (rows with an area) with `area=`, `actorUserId=`, `platformAdmin=`, `from=`, `patientId=`, `visitId=` |

## Events

- Emits: —
- Consumes: every domain event (catch-all channel); stored with `resource_type = 'event'`, the
  event name as `action` and the payload as `after`. Events without a tenant are not stored;
  platform-global actions (admin bootstrap) are logged by pino only.

## Depends on

— (every other module depends on `audit`)

## Permissions

`audit:read`.
