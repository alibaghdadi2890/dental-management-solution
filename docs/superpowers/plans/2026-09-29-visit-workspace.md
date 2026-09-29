# Feature 4a — Visit lifecycle and clinical workspace — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. As in the earlier plans, the code itself lives in the commits. Each
> task names its files, the tests to write first, the non-obvious code, and the verification
> commands.

**Goal:** Ship feature 4a per `docs/superpowers/specs/2026-09-29-visit-workspace-design.md`
(V1–V11, W1–W24): starting, charting, pricing and completing a visit in one workspace; records
on the tooth dated by the visit; a charge posted atomically at completion; the chart settings.

**Architecture:**

- **Tooth model:** `packages/contracts` gains pure `tooth.ts`, `chart.ts` and `visit-money.ts`,
  shared by the API and the SPA.
- **`clinical`:** gains five tables (`visits`, `visit_services`, `patient_diagnoses`,
  `treatment_plans`, `tooth_status`) and three services:
  - `VisitsService`: the lifecycle;
  - `VisitRecordsService`: charting inside a live visit;
  - `ChartService`: patient reads.
- **Concurrency:** a partial unique index for rooms and an advisory lock per patient.
- **Platform:** gains in-transaction domain event handlers, which `billing` (the visit charge)
  and `clinical` (the merge re-point) use. No new queue or other Redis use.
- **Smaller changes:**
  - `tenancy`: three chart settings;
  - `patients`: a dentition override, and `lockForLedger` renamed `lockForDependentWrite`;
  - `users`: practitioners by branch.

**Tech stack:** unchanged — NestJS 11, Drizzle + drizzle-kit, Zod/nestjs-zod, Vitest +
Testcontainers, React + Vite + TanStack Router/Query, shadcn/ui + Tailwind, i18next, Playwright.

**Branch and commits:** work on `feat/visit-workspace` off `main`. **Create the branch and make
commits only once the user has authorised git writes for this run** (standing rule). One commit
per task, ending with the `Co-Authored-By` trailer.

**Gate for every task:**

- `pnpm lint && pnpm typecheck` green.
- Contracts tests pass: `pnpm --filter @dcm/contracts test`.
- API unit and integration tests pass: `pnpm --filter @dcm/api test:unit test:integration`.
- Web tests pass: `pnpm --filter @dcm/web exec vitest run --maxWorkers=2 --testTimeout=30000`.
- Web build passes: `pnpm --filter @dcm/web build`.
- `pnpm format:check` is clean.
- The touched modules' docs are updated in the same task.

**Local environment rules:**

- The user's `pnpm dev` (`nest --watch`, `vite`, `tsc --watch`) is running. Never kill it.
- Never run the API build: it clears `apps/api/dist`, which `nest --watch` serves from.
- To make the dev API pick up changes, touch `apps/api/src/main.ts`.
- Postgres runs in Compose on port 55432 as `dcm_owner`. Local ports 5432 and 6379 belong to
  other processes. Pre-pull the Testcontainers images if the first integration run times out.
- After each migration task, run `pnpm --filter @dcm/api db:migrate` against the dev DB and
  touch `main.ts`.

**Execution order (keeps every commit green):**

- Contracts: A1 → A2 → A3 → A4
- Backend: B1 → B2 → C1 → C2 → D1 → D2 → E1 → E2 → E3
- Web: F1 → F2 → G1 → G2 → G3 → G4 → G5 → H1 → H2
- Finish: I1

Backend tasks never depend on web tasks. The web tasks need the routes from C2, D1, D2 and E2.

---

## Step (a) — contracts and chart settings

### Task A1: Tooth model

**Files:**

- `packages/contracts/src/tooth.ts` (+ `tooth.spec.ts`), new.
- `packages/contracts/src/index.ts`: export it.

**API (all pure):**

```ts
export const TOOTH_NOTATIONS = ['fdi', 'universal'] as const;
export const CHART_ORIENTATIONS = ['patient_right_on_right', 'patient_right_on_left'] as const;
export const CHART_MODES = ['surface', 'simple'] as const;
export const SURFACES = ['M', 'D', 'B', 'L', 'O', 'I'] as const;
export const PERMANENT_CODES: readonly ToothCode[]; // 11–18, 21–28, 31–38, 41–48
export const PRIMARY_CODES: readonly ToothCode[]; // 51–55, 61–65, 71–75, 81–85
export const toothCodeSchema: z.ZodType<ToothCode>; // exactly the 52 codes
export const surfacesSchema; // array of SURFACES, no duplicates, max 5
export function quadrant(code): 1 | 2 | 3 | 4; // primary 5–8 → 1–4
export function position(code): number; // second digit
export function isPrimary(code): boolean;
export function isUpper(code): boolean;
export function isAnterior(code): boolean; // position ≤ 3
export function toUniversal(code): string; // '3', 'A'
export function parseTooth(text, notation): ToothCode | null;
export function toothLabel(code, notation): string; // FDI '#16' '#55'; Universal '#3' 'A'
export function successorOf(primary): ToothCode; // 54 → 14
export function predecessorOf(permanent): ToothCode | null; // 14 → 54; 16 → null
export function positionKey(code): ToothCode; // the permanent code of the column
export function archColumns(o): { upper: ToothCode[]; lower: ToothCode[] }; // permanent codes, screen left → right
export function keyboardOrder(o): ToothCode[]; // upper L→R, then lower L→R
export function surfaceCells(code, o): [SurfaceKey, 'B', SurfaceKey, 'O' | 'I', 'L'];
export function validSurfaces(code, surfaces): boolean; // no I on posterior, no O on anterior
export function anatomicalName(code): { key: string; params: { quadrant: string; tooth: string } };
export function slotFor(stage, position): 'permanent' | 'primary' | 'not_erupted';
export function effectiveDentition(
  ageYears: number | null,
  override: DentitionStage | null,
): { stage: DentitionStage; source: 'auto' | 'override' };
export function presentTooth(
  column: ToothCode,
  stage,
  presence?: 'primary' | 'permanent',
): { code: ToothCode; notErupted: boolean };
```

**Mappings (pin them in tests):**

- **Universal permanent:** UR `9 − p`, UL `8 + p`, LL `25 − p`, LR `24 + p`.
- **Universal primary:** UR `'A' + (5 − p)`, UL `'F' + (p − 1)`, LL `'K' + (5 − p)`,
  LR `'P' + (p − 1)` (the POC's `PRIM_OF`).
- **Columns for `patient_right_on_left`:** upper `18…11, 21…28`, lower `48…41, 31…38`.
- **Columns for `patient_right_on_right`:** the reverse of each row.
- **Mesial on the glyph's left:** true when the tooth sits on the screen's right half (the
  midline is to its left). That is `(UL || LL)` for `patient_right_on_left`, and `(UR || LR)`
  for `patient_right_on_right`. The POC ignores orientation here and draws the glyph mirrored
  in its reversed view; this plan follows the spec ("never mirrored").
- **Slots:** mixed = positions 1–2 permanent, 3–5 primary, 6 permanent, 7–8 not erupted;
  primary = 1–5 primary, 6–8 not erupted; permanent = all permanent.
- **Dentition:** reuse `dentitionStage` and `DENTITION_STAGES` from `patient-age.ts`; no age →
  `permanent`.
- **Anatomical names** are i18n keys (`tooth.name`, with `quadrant` and `tooth` keys such as
  `upperRight` and `firstMolar`, and `tooth.primaryName`), so the SPA translates them.

- [ ] **Tests first:**
  - A table test over all 52 codes: `toUniversal` → `parseTooth` round trip in both notations,
    `quadrant`, `position`, `isAnterior` and `isUpper` against a literal table.
  - `toothLabel('16','universal') === '#3'`; `toothLabel('55','universal') === 'A'`;
    `toothLabel('55','fdi') === '#55'`.
  - `successorOf`/`predecessorOf` for every primary code; `predecessorOf('16') === null`.
  - `archColumns` for both orientations (literal arrays); `keyboardOrder` has 32 unique
    entries and wraps.
  - `surfaceCells('16','patient_right_on_left')` → `['D','B','M','O','L']`; `'21'` → centre
    `'I'` with `'M'` on the left; the right-on-right view flips both.
  - `validSurfaces('11',['O'])` is false; `validSurfaces('16',['I'])` is false.
  - `slotFor` for every stage and position; `effectiveDentition(null,null)` is permanent/auto;
    `effectiveDentition(8,'permanent')` is permanent/override.
  - `presentTooth('14','mixed')` → `54`; with presence `permanent` → `14`; `'17'` in mixed →
    `notErupted`.
- [ ] **Implement**, then run `pnpm --filter @dcm/contracts test`.
- [ ] **Commit:** `feat(contracts): canonical FDI tooth model with notation and orientation`.

### Task A2: Visit and record contracts, visit money

**Files:**

- `packages/contracts/src/visit-money.ts` (+ spec), new. This is the pure money rule, shared so
  that the SPA's live preview rounds exactly like the server. The spec placed it in
  `clinical/domain`; `clinical` imports it from here instead.
- `packages/contracts/src/visits.ts` (+ spec), new: visit, lifecycle and service schemas.
- `packages/contracts/src/clinical-records.ts` (+ spec), new: diagnosis records, plans, tooth
  status, chart, history, last visit and summary schemas.
- `packages/contracts/src/permissions.ts`: unchanged (`visit:*` exist). Just confirm.
- `packages/contracts/src/index.ts`.

**`visit-money.ts`:**

```ts
export type DiscountMode = 'percent' | 'amount';
export interface MoneyLine {
  base: string;
  discount: string;
} // decimal strings
export interface VisitMoney {
  subtotal: string;
  discount: string;
  total: string;
  capped: boolean;
}
export function lineFinal(line: MoneyLine): string; // base − discount
export function visitMoney(lines: MoneyLine[], mode: DiscountMode, value: string): VisitMoney;
```

- Everything is computed on `bigint` cents.
- `percent`: `P = value × 100` (hundredths of a percent);
  `discount = (subtotal × min(P, 10000) + 5000n) / 10000n` (round half up; non-negative).
- `amount`: `min(value, subtotal)`.
- `capped` is true when the raw percent is above 100, or the raw amount is above the subtotal.
- `durationMinutes(elapsedSeconds)` = `max(1, ceil(s / 60))` lives here too.

**`visits.ts`:**

- Enums: `visitStatusSchema` = `in_progress | paused | completed | discarded`;
  `discountModeSchema`.
- `visitServiceSchema` `{ id, procedureId, code, name, category, chargeUnit, toothCode|null, surfaces, base: Money, discount: Money, final: Money, planId|null, recordedBy, createdAt }`.
- `visitSchema` `{ id, patientId, branchId, roomId|null, dentistId, startedBy, status, localDate, startedAt, pausedAt|null, pausedSeconds, completedAt|null, durationMinutes|null, notes, discountMode, discountValue, currency, services, money: { subtotal, discount, total, capped }, serverNow }`.
- Inputs:
  - `startVisitSchema` `{ patientId, dentistId, roomId? }`;
  - `visitNotesSchema` `{ notes ≤ 20000 }`;
  - `visitDiscountSchema` `{ mode, value: nonNegativeAmountSchema }`;
  - `addServiceSchema` `{ procedureId, toothCode?, surfaces }`;
  - `updateServiceSchema` `{ baseAmount?, discountAmount? }` (at least one).
- `startVisitResultSchema` `{ visit, resumed }`.
- `liveVisitRefSchema` `{ id, patientId, patientName, dentistName, status, startedAt, pausedAt, pausedSeconds }`.
- `liveVisitQuerySchema` `{ patientId?, mine?: boolean }`.
- `startDefaultsSchema` `{ dentistId|null, roomId|null }`.

**`clinical-records.ts`:**

- Record schemas:
  - `diagnosisRecordSchema`, from `patient_diagnoses` (camelCase, plus `dentistName`,
    `recordedInVisitDate`);
  - `treatmentPlanSchema`;
  - `toothPresenceSchema` `{ position, present }`.
- Inputs:
  - `recordDiagnosisSchema` `{ diagnosisId, toothCode, surfaces, note? }`;
  - `planTreatmentSchema` `{ procedureId, toothCode?, surfaces, note? }`;
  - `setToothPresenceSchema` `{ present: 'primary' | 'permanent' }`.
- `historyServiceSchema` `{ id, visitId, visitDate, dentistName, code, name, toothCode, surfaces, final: Money }`.
- `patientChartSchema` `{ dentition: { stage, source, ageYears|null }, toothStatus, diagnoses, plans, history, liveVisitId|null, teeth: ToothState[] }`.
- `toothHistorySchema` `{ toothCode, diagnoses, plans, services }`.
- `lastVisitSchema` (nullable) `{ id, date, dentistName, durationMinutes, total, services: { name, toothCode }[], notes }`.
- `clinicalSummarySchema` `{ visits, activeDiagnoses, plannedProcedures, teethTreated, servicesPerformed }`.

- [ ] **Tests first:**
  - `visitMoney`:
    - 2 lines (100 − 20, 50) at 10 % → subtotal 130.00, discount 13.00, total 117.00;
    - 12.5 % of 0.10 → 0.01 (half up);
    - 150 % → capped, total 0;
    - an amount of 500 on a subtotal of 130 → capped, discount 130;
    - no lines → all 0.
  - `lineFinal('50.00','0.00')`.
  - `durationMinutes(0) === 1`, `(61) === 2`.
  - The schemas reject unknown tooth codes and duplicate surfaces, and require at least one field
    in `updateServiceSchema`.
- [ ] **Implement**, then run `pnpm --filter @dcm/contracts test`.
- [ ] **Commit:** `feat(contracts): visit, clinical record and visit money contracts`.

### Task A3: Chart derivation

**Files:** `packages/contracts/src/chart.ts` (+ `chart.spec.ts`), new.

```ts
export type ToothVisualState = 'treated_today' | 'treated' | 'planned' | 'none';
export interface ToothState {
  code: ToothCode;
  state: ToothVisualState;
  surfaces: Partial<Record<SurfaceKey, 'treated_today' | 'treated'>>;
  wholeTooth: 'treated_today' | 'treated' | null;
  hasActiveDiagnosis: boolean;
  openPlanIds: string[];
  historyCount: number;
  titleParts: { diagnoses: string[]; plans: string[]; historyCount: number };
}
export function deriveChart(input: {
  diagnoses: DiagnosisRecord[];
  plans: TreatmentPlan[];
  history: HistoryService[];
  liveServices: VisitService[];
}): Map<ToothCode, ToothState>;
```

**Rules:**

- The precedence is `treated_today > treated > planned > none`.
- A service with no surfaces tints the whole tooth.
- The per-surface state is the union of history and the live visit, with live winning.
- Open plans only (`planned`). Active diagnoses only.
- Removed (deleted) rows never reach this function.

- [ ] **Tests first:**
  - Each precedence pair.
  - Whole-tooth vs surface services.
  - A live service overrides a historic one on the same surface.
  - A performed plan doesn't count as planned.
  - A resolved diagnosis doesn't set `hasActiveDiagnosis`.
  - Jaw-level services (`toothCode` null) touch no tooth.
- [ ] **Implement**, then run the tests.
- [ ] **Commit:** `feat(contracts): derived per-tooth chart state`.

### Task A4: Tenancy chart settings

**Files:**

- `packages/contracts/src/tenancy.ts` (+ spec):
  - `tenantSchema` and `tenantSettingsPatchSchema` gain `chartMode`, `toothNotation` and
    `chartOrientation`;
  - `TENANT_DEFAULTS` gains `surface`, `fdi` and `patient_right_on_right`.
- `packages/contracts/src/session.ts` (+ spec): `tenant` gains the three fields.
- `apps/api/src/modules/tenancy/persistence/schema.ts`: enums `chart_mode`, `tooth_notation`
  and `chart_orientation`, and three `not null` columns with defaults.
- `apps/api/src/modules/tenancy/application/tenancy.service.ts`: map and patch them.
- The session builder (`modules/users`: `GET /session`, where `tenant` is assembled): include
  them.
- Migration: `pnpm --filter @dcm/api db:generate --name tenant_chart_settings`. Review it:
  defaults backfill the existing tenants.
- `apps/api/test/integration/tenancy.int-spec.ts`, `session.int-spec.ts`.
- Web fixtures that build a `Session`/`Tenant` (`apps/web/src/shell/shell.test-utils.tsx`,
  `features/patients/patients.test-utils.tsx`, any `tenant:` literal found by
  `grep -rn "country: 'LB'" apps/web/src`): add the three fields.
- Docs:
  - `docs/modules/tenancy.md` (settings);
  - `docs/adr/0021-canonical-fdi-tooth-codes.md`, new (W3, W17, V1) and the ADR index
    (`docs/adr/README.md`).

- [ ] **Integration tests first:**
  - A new tenant has the defaults.
  - `PATCH /tenant { toothNotation: 'universal' }` as the owner → 200 and audited.
  - As a dentist → 403.
  - An unknown value → 400.
  - `GET /session` carries the three fields.
- [ ] **Implement, generate and migrate the dev DB.**
- [ ] **Commit:** `feat(tenancy): chart detail, tooth notation and orientation settings`.

---

## Step (b) — patients and users

### Task B1: Dentition override and the lock rename

**Files:**

- `packages/contracts/src/patients.ts` (+ spec):
  - `patientSchema` gains `dentitionOverride: DentitionStage | null`;
  - `dentitionOverrideSchema` `{ override: DentitionStage | null }`.
- `apps/api/src/modules/patients/persistence/schema.ts`: the `dentition` enum and a nullable
  `dentition_override` column.
- `apps/api/src/modules/patients/application/patients.service.ts`:
  - `setDentition(id, input)`: requires `visit:write` (W14); locks the patient `FOR UPDATE`;
    archived or merged → 409; audits `patient.dentition` with before/after; returns the patient.
  - Rename `lockForLedger` → `lockForDependentWrite` (docstring: "a dependent module's write on
    this patient").
- `apps/api/src/modules/patients/http/patients.controller.ts`: `PUT /patients/:id/dentition`,
  `@RequirePermission('visit:write')`.
- `apps/api/src/modules/billing/application/billing.service.ts`: the renamed call.
- `apps/api/src/modules/patients/index.ts`: unchanged apart from the rename (the method is on
  the exported service).
- Migration: `db:generate --name patient_dentition`.
- Tests: `patients.int-spec.ts`; existing billing tests keep passing.
- Web: `features/patients/patients-api.ts` gains `setDentition`, and the patient fixtures gain
  the field.
- Docs: `docs/modules/patients.md` (the field, the method, the rename) and `billing.md` (the
  rename).

- [ ] **Integration tests first:**
  - A dentist sets `mixed` → 200, audited.
  - `null` → back to auto.
  - Frontdesk → 403.
  - An archived patient → 409 `patient.archived`.
  - `lockForDependentWrite` keeps `lockForLedger`'s tests (renamed).
- [ ] **Implement, generate and migrate.**
- [ ] **Commit:** `feat(patients): dentition override; lockForDependentWrite`.

### Task B2: Practitioners by branch

**Files:**

- `packages/contracts/src/users.ts` (+ spec): `practitionerQuerySchema` `{ branchId? }`.
- `apps/api/src/modules/users/application/users.service.ts`: `listPractitioners({ branchId? })`
  joins `staff_branches` when `branchId` is given.
- `apps/api/src/modules/users/http/*.controller.ts`: `GET /users/practitioners?branchId=`.
- `apps/api/test/integration/users.int-spec.ts`.
- `docs/modules/users.md`.

- [ ] **Integration tests first:**
  - Two dentists in different branches: the filter returns one; no filter returns both;
    inactive staff are excluded.
  - An unknown branch → `[]`.
- [ ] **Implement.**
- [ ] **Commit:** `feat(users): list practitioners by branch`.

---

## Step (c) — visits

### Task C1: Clinical schema and domain

**Files:**

- `apps/api/src/modules/clinical/persistence/schema.ts`: enums (`visit_status`,
  `discount_mode`, `diagnosis_status`, `plan_status`, `tooth_presence`) and the five tables per
  the spec's data model. Composite foreign keys on `(tenant_id, id)` inside `clinical` (the
  `rooms` pattern), for:
  - `visit_services.visit_id`;
  - `visit_services.plan_id`;
  - `patient_diagnoses.recorded_in_visit_id` / `resolved_in_visit_id`;
  - `treatment_plans.*_visit_id` and `diagnosis_record_id`;
  - `tooth_status.changed_in_visit_id`.

  Required indexes and checks:
  - `visits_room_live_unique` on `(tenant_id, room_id) where status in ('in_progress','paused') and room_id is not null`;
  - `visit_services_plan_unique` on `(tenant_id, plan_id) where deleted_at is null and plan_id is not null`;
  - `tooth_status_position_unique` on `(tenant_id, patient_id, position)`;
  - the checks on paused/completed fields, `0 ≤ discount ≤ base`, `tooth_code` iff
    `per_tooth`, and `surfaces <@ '{M,D,B,L,O,I}'`.

- `modules/clinical/domain/`, new files (each with a spec):
  - `visit-lifecycle.ts`: `transition(status, action)` → the next status, or throws
    `IllegalVisitTransitionError`.
  - `visit-timer.ts`:
    - `elapsedSeconds({ startedAt, pausedAt, pausedSeconds, completedAt }, now)`;
    - `resumePausedSeconds(visit, now)`.
  - `discard-rule.ts`: `isDiscardable(facts: { services, diagnosesRecorded, diagnosesResolved, plansRecorded, plansPerformed, plansCancelled, toothChanges, notes })`.
  - `record-rules.ts`:
    - `assertTarget(chargeUnit, toothCode, surfaces)`: `per_tooth` needs a tooth → 422
      `visit.tooth_required`; `per_jaw` with a tooth → 422 `visit.tooth_not_allowed`; bad
      surfaces → 422 `visit.surfaces_invalid`;
    - `assertCurrency(visitCurrency, priceCurrency)` → 422 `visit.currency_mismatch`.
  - `visit-errors.ts`: `VisitNotFoundError` (404 `visit.not_found`), `VisitNotLiveError` (409
    `visit.not_live`), `RoomBusyError` (409 `visit.room_busy`), `VisitNotEmptyError` (409
    `visit.not_empty`), `RecordNotRemovableError` (409 `record.not_removable`),
    `PlanNotOpenError` (409 `plan.not_open`), and the 422 codes `visit.branch_required`,
    `visit.dentist_invalid`, `visit.room_invalid` and `visit.room_required`. All extend
    `DomainError` with `code` and `kind`.
- Migration: `db:generate --name visits`. Review it: RLS policies on all five tables, the
  composite FKs, the partial indexes, the checks.
- `apps/api/test/integration/tenant-isolation.int-spec.ts`: it auto-discovers tables; confirm
  all five are covered, and extend it if the discovery needs a seed row per table.

- [ ] **Unit tests first:**
  - Lifecycle:
    - every legal transition;
    - `completed → pause` and `discarded → complete` throw.
  - Timer:
    - running;
    - paused (frozen at `pausedAt`);
    - resume adds the pause;
    - completed.
  - Discard rule: empty → true; each fact alone → false; a discount alone → true.
  - Record rules: each 422 case.
- [ ] **Migration review and dev DB migrate.**
- [ ] **Commit:** `feat(clinical): visits and clinical record tables, visit domain rules`.

### Task C2: `VisitsService` lifecycle, routes and concurrency

**Files:**

- `modules/clinical/persistence/visits.repository.ts`:
  - `lockLive(id)`: `FOR UPDATE`, live only, else throws;
  - `findLiveForPatient(patientId)`;
  - `insert`, `update`;
  - `lastRoomToday(userId, localDate)`;
  - `liveRefs(filter)`;
  - `discardFacts(id)`: one query with `exists` subqueries.
- `modules/clinical/persistence/visit-services.repository.ts`: `listForVisit(id)` (not deleted).
- `modules/clinical/application/visits.service.ts`: `start`, `startDefaults`, `pause`,
  `resume`, `updateNotes`, `setDiscount`, `discard`, `get` and `live` per the spec (`complete`,
  `chargeFacts` and `visitMoney` come in E2).
- `modules/clinical/events/visit-events.ts`: `VisitStarted`, `VisitPaused`, `VisitResumed`,
  `VisitDiscarded` (and the `VisitCompleted` type, used in E2).
- `modules/clinical/http/visits.controller.ts`:
  - `POST /visits`, `GET /visits/start-defaults`, `GET /visits/live`, `GET /visits/:id`;
  - `POST /visits/:id/{pause,resume,discard}`;
  - `PATCH /visits/:id/{notes,discount}`.
- `modules/clinical/clinical.module.ts`: import `PatientsModule`, `UsersModule` and
  `TenancyModule` (the edges already planned).
- `modules/clinical/index.ts`: export `VisitsService`, the event names and types.
- Tests: `apps/api/test/integration/visits.int-spec.ts`, new.
- Docs:
  - `docs/modules/clinical.md` (visits section);
  - `docs/adr/0023-live-visit-concurrency.md`, new (W1, W4, W7, W22, W24);
  - the ADR index.

**`start`, in one `TenantDb.run`:**

```ts
const branchId = this.context.branchId ?? throw new VisitBranchRequiredError();
await this.patients.lockForDependentWrite(input.patientId);     // FOR SHARE; archived → 409, merged → 409
await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`visit-start:${input.patientId}`}, 0))`);
const live = await this.visits.findLiveForPatient(input.patientId);
if (live) return { visit: await this.load(live.id), resumed: true };
// dentist: (await users.listPractitioners({ branchId })).some(p => p.id === input.dentistId)
// room: (await tenancy.listRooms(branchId)).filter(active); required iff that list is non-empty
// insert with currency = tenant.currency, localDate = localDate(clock.now(), tenant.timeZone),
//   startedBy = context.requireUserId() (W10); map unique violation 'visits_room_live_unique' → RoomBusyError
// audit visit.start; publish VisitStarted { visitId, patientId, dentistId, roomId }
```

- The patient lock comes first, then the visit (W24).
- `startedBy`, `discardedBy` and every other actor column come from
  `RequestContext.requireUserId()`, never a profile id (W10).
- `startDefaults()`:
  - `dentistId` = the caller's staff profile id when they are a dentist assigned to the active
    branch, else null;
  - `roomId` = `lastRoomToday(userId, today)` if that room is still active and free, else null.
- `live({ mine })` resolves the caller's profile id via `UsersService.get(userId).profileId`
  (null for a platform admin without a profile) and matches
  `dentist_id = profileId or started_by = userId`.
- `get` returns `serverNow = clock.now()` and the money from `visitMoney(...)` (contracts)
  while the visit is live.

- [ ] **Integration tests first (`visits.int-spec.ts`):**
  - A dentist starts a visit → 201; the same patient again → 200 `resumed: true` with the same
    id.
  - **Two parallel starts** for one patient (`Promise.all`) → one visit, one `resumed`.
  - A second patient in the same room → 409 `visit.room_busy` (problem+json `code`).
  - A branch with no rooms → a start with no room succeeds; a branch with rooms and no room →
    422 `visit.room_required`.
  - A dentist of another branch → 422 `visit.dentist_invalid`.
  - An archived patient → 409.
  - Frontdesk start → 403; frontdesk `GET /visits/:id` → 200.
  - Pause, then 2 s of fake clock, then resume → `pausedSeconds` grows by 2.
  - Notes and discount PATCH persist and audit `visit.update`.
  - Discard of an empty visit → `discarded`, the room is free again, and `GET` → 404. Discard
    after notes → 409 `visit.not_empty`.
  - `live?mine=true` for the dentist and for the assistant who started the visit; not for
    another dentist.
  - `startedBy`/`discardedBy` equal the auth user id.
- [ ] **Implement.**
- [ ] **Commit:** `feat(clinical): start, resume, pause, discard and live visits`.

---

## Step (d) — records and reads

### Task D1: `VisitRecordsService`

**Files:**

- `modules/clinical/persistence/patient-diagnoses.repository.ts`,
  `treatment-plans.repository.ts`, `tooth-status.repository.ts`, new. Extend
  `visit-services.repository.ts`.
- `modules/clinical/application/visit-records.service.ts`, new: the methods in the spec's
  table.
- `modules/clinical/events/record-events.ts`: `DiagnosisRecorded`, `DiagnosisResolved`,
  `DiagnosisReopened`, `TreatmentPlanned`, `TreatmentPerformed`, `TreatmentCancelled`,
  `ToothStatusChanged`.
- `modules/clinical/http/visits.controller.ts`, the record routes:
  - `POST /visits/:id/services`, `PATCH /visits/:id/services/:serviceId`,
    `DELETE /visits/:id/services/:serviceId`;
  - `POST /visits/:id/diagnoses`, `POST /visits/:id/diagnoses/:recordId/{resolve,reopen}`,
    `DELETE /visits/:id/diagnoses/:recordId`;
  - `POST /visits/:id/plans`, `POST /visits/:id/plans/:planId/{perform,cancel}`,
    `DELETE /visits/:id/plans/:planId`;
  - `PUT /visits/:id/teeth/:position`.

  Each returns the updated `Visit` (services and money) plus, for record routes, the affected
  record: `{ visit, record }`.

- Tests: `apps/api/test/integration/visit-records.int-spec.ts`, new.

**Rules per method (every one):**

1. Re-check `visit:write`.
2. `visits.lockLive(visitId)`.
3. The patient is `visit.patientId`, never a request field.
4. The catalog row comes from `CatalogService.getService/getDiagnosis`; `active=false` → 422
   `catalog.inactive` (add the error to `catalog-errors.ts`).
5. The snapshot fields are copied.
6. `recorded_by`/`changed_by` = `requireUserId()`; `dentist_id` = `visit.dentistId`.
7. Audit with before/after.
8. Publish the record's event (not for services, notes or discount).

**Method notes:**

- `planTreatment` links `diagnosis_record_id` to the tooth's most recent active diagnosis
  (`order by recorded_at desc limit 1`), or null.
- `performPlan`:
  - plan `planned` → `assertCurrency`;
  - insert the service (`base = plan.price`, `discount = 0`, `plan_id`, the plan's tooth and
    surfaces);
  - set the plan `performed` with `performed_in_visit_id` and `performed_at`.
- `removeService`: when `plan_id` is set, the plan goes back to `planned` (clears
  `performed_*`); this is the Undo.
- `removeDiagnosis`:
  - only if `recorded_in_visit_id = visitId`, else 409;
  - unlinks plans (`diagnosis_record_id = null`);
  - soft-deletes.
- `removePlan`: only if recorded in this visit and `planned`. `cancelPlan`: only for plans
  recorded in an earlier visit and `planned`.
- `setToothPresence`:
  - `position` must be a permanent code with position 1–5 (else 422
    `visit.position_invalid`);
  - upsert on `(tenant, patient, position)`.

- [ ] **Integration tests first:**
  - Service:
    - add a per-tooth service with surfaces;
    - a per-tooth service with no tooth → 422;
    - a per-jaw service with a tooth → 422;
    - an inactive catalog row → 422;
    - a price edit with `discount > base` → 422 at `discountAmount`;
    - remove → gone from the visit money.
  - Diagnosis:
    - record, resolve, reopen;
    - remove an older one → 409 `record.not_removable`;
    - remove one from this visit unlinks its plan.
  - Plan:
    - it links the latest active diagnosis;
    - perform → the service has `planId`, the plan is `performed`;
    - removing the service restores `planned`;
    - perform twice → 409 `plan.not_open`;
    - cancel an older plan;
    - remove a this-visit plan.
  - Cross-visit behaviour (a plan from visit 1 performed in visit 2) needs `complete` and is
    tested in E2.
  - Tooth presence: an upsert, and an invalid position → 422.
  - Frontdesk → 403 on every route. A completed or discarded visit → 409 `visit.not_live`.
  - Audit actions and `recorded_by` = the auth user id.
- [ ] **Implement.**
- [ ] **Commit:** `feat(clinical): chart services, diagnoses, plans and tooth presence in a visit`.

### Task D2: `ChartService`, patient reads, `isInUse`

**Files:**

- `modules/clinical/application/chart.service.ts`, new: `chart`, `toothHistory`,
  `lastVisit`, `summary` (`visit:read`).
- `modules/clinical/http/clinical-patients.controller.ts`, new:
  `GET /clinical/patients/:id/{chart,summary,last-visit}` and
  `GET /clinical/patients/:id/teeth/:toothCode/history`.
- `modules/clinical/application/catalog.service.ts`: `isInUse(id)` checks `visit_services`,
  `treatment_plans` and `patient_diagnoses` (non-deleted) with one `exists` query per catalog.
- `modules/clinical/index.ts`: export `ChartService`.
- Tests: `apps/api/test/integration/clinical-chart.int-spec.ts`, new;
  `catalog.int-spec.ts` (in use).
- Docs:
  - `docs/modules/clinical.md` (records, reads, `isInUse`, the Universal line replaced);
  - `docs/adr/0022-records-on-the-tooth-dated-by-visit.md`, new (V5, W5, W9, W10, W11, W13,
    W15);
  - the ADR index.

**Reads:**

- `chart`:
  - the patient via `PatientsService.get` (404 passes through), for `dateOfBirth` and
    `dentitionOverride`;
  - the age from `ageOn(dob, tenantToday)`;
  - `effectiveDentition`;
  - records: non-deleted diagnoses and plans of the patient; history = services of `completed`
    visits; `liveVisitId` = the patient's live visit (most recent);
  - `teeth = [...deriveChart({ ..., liveServices })]`.
- Dentist names come in one `UsersService.practitionersByProfileIds` call.
- `lastVisit`: the most recent `completed` visit, by `completed_at desc`.
- `summary`:
  - `visits` = completed count;
  - `activeDiagnoses`;
  - `plannedProcedures` (`planned`);
  - `teethTreated` = distinct `tooth_code` of completed services;
  - `servicesPerformed`.

- [ ] **Integration tests first:**
  - Chart:
    - an 8-year-old → `mixed`/auto;
    - an override → the override;
    - no DOB → permanent.
  - Tooth history within one live visit lists diagnosis → plan (and the history of completed
    visits once E2 adds `complete`; E2 extends this test).
  - `lastVisit` is null, then the latest.
  - The summary counts.
  - `isInUse` is true after `addService` and false for an unused row. Deleting a used catalog
    row → 409 `catalog.in_use`.
  - Frontdesk may read.
  - Another tenant's patient → 404.
- [ ] **Implement.**
- [ ] **Commit:** `feat(clinical): patient chart, tooth history, last visit and summary reads`.

---

## Step (e) — completion, charge and merge

### Task E1: In-transaction domain event handlers (platform)

**Files:**

- `apps/api/src/platform/events/event-bus.ts` (+ `event-bus.spec.ts`).
- `CLAUDE.md` §9 (amendment, W23).

**Implementation:**

```ts
const IN_TRANSACTION = 'in-transaction:';
/** Runs inside the publisher's open transaction, before commit; a throw rolls it back (W23). */
export const OnDomainEventInTransaction = (name: string): MethodDecorator =>
  OnEvent(`${IN_TRANSACTION}${name}`, { suppressErrors: false }); // @OnEvent swallows errors by default

async publish(event: DomainEvent): Promise<void> {
  const channel = `${IN_TRANSACTION}${event.name}`;
  if (this.emitter.listenerCount(channel) > 0) {
    if (!this.tenantDb.currentTransaction()) {
      throw new Error(`${event.name} has in-transaction handlers and needs an open transaction`);
    }
    await this.emitter.emitAsync(channel, event); // rejects on a handler error → rolls back
  }
  if (this.tenantDb.afterCommit(() => this.dispatch(event))) return;
  await this.dispatch(event);
}
```

- **Why `suppressErrors: false` matters:** `@nestjs/event-emitter`'s subscriber loader
  swallows handler errors unless `suppressErrors` is false
  (`event-subscribers.loader.js`: `options?.suppressErrors ?? true`). Pin this with a test.
- **Handlers run in the async context of `publish`**, so they join the open `TenantDb`
  transaction through `TenantDb.run` (the nested call returns the same `tx`), and they see the
  publisher's CLS (tenant, user, permissions).

- [ ] **Unit tests first (`event-bus.spec.ts`, with a fake `TenantDb`):**
  - An in-transaction handler runs before the after-commit hook.
  - A throw rejects `publish`, and the after-commit dispatch never runs.
  - Publishing with in-transaction listeners and no open transaction throws.
  - Events without in-transaction listeners behave exactly as before.
- [ ] **Integration test** (`test/integration/event-bus.int-spec.ts`, new): a test module with an
      in-transaction handler that inserts into a scratch table in the same transaction. The
      publisher's transaction rolls back when the handler throws, and neither row exists.
      The generic audit subscriber still records the event only after a commit.
- [ ] **Implement.** Amend CLAUDE.md §9 in the same commit: "Reactions that must be atomic with
      the change subscribe with `@OnDomainEventInTransaction` (database work only, own tables,
      fast); slow or external reactions enqueue a job."
- [ ] **Commit:** `feat(platform): in-transaction domain event handlers`.

### Task E2: Complete, the visit charge, the summary

**Files:**

- `modules/clinical/application/visits.service.ts`: `complete`, `chargeFacts`, `visitMoney`.
- `modules/clinical/http/visits.controller.ts`: `POST /visits/:id/complete`.
- `modules/clinical/index.ts`: export `VISIT_COMPLETED` and `VisitCompleted`.
- `modules/billing/persistence/schema.ts`:
  - `ledger_entry_kind` + `visit_charge`;
  - `ledger_entries.visit_id`, with the check `(visit_id is not null) = (kind = 'visit_charge')`
    and a partial unique index `ledger_entries_visit_unique`;
  - the `ledger_entry_lines` table.
- Migrations. Postgres can't use a new enum value in the transaction that adds it, so generate
  two:
  - `db:generate --name ledger_visit_charge_kind` (only the `ALTER TYPE … ADD VALUE`; move the
    rest out if drizzle-kit bundles it);
  - `db:generate --name ledger_visit_charges` (column, check, index, lines table);
  - `db:generate --custom --name ledger_lines_append_only`: grants like
    `0011_ledger_append_only`. The runtime roles get no `UPDATE`, `DELETE` or `TRUNCATE` on
    `ledger_entry_lines`, and no update on `ledger_entries.visit_id`.
- `modules/billing/application/visit-charge.subscriber.ts`, new (in-transaction).
- `modules/billing/application/billing.service.ts`:
  - `visitSummary(visitId)`;
  - `balanceOf` gains `charged`;
  - the ledger entry domain type gains `visit_charge`.
- `modules/billing/domain/ledger-entry.ts`, `balances.ts` (+ spec, for `charged`).
- `modules/billing/http/billing.controller.ts`: `GET /billing/visits/:visitId/summary`.
- `packages/contracts/src/billing.ts` (+ spec):
  - `LEDGER_ENTRY_KINDS` + `visit_charge`;
  - `patientBalanceSchema.charged`;
  - `visitFinancialSummarySchema` `{ visitId, currency, visit: { total, paid, outstanding }, previous, totalOutstanding }`.
- `modules/billing/billing.module.ts`: import `ClinicalModule` (the new edge, W21).
- Tests:
  - `apps/api/test/integration/billing-visit-charge.int-spec.ts`, new;
  - extend `visits.int-spec.ts` (complete) and `clinical-chart.int-spec.ts` (history across
    two completed visits).
- Docs:
  - `docs/modules/clinical.md` (complete, events), `billing.md` (`visit_charge`, lines, the
    handler, the summary route, `charged`, the new dependency);
  - `docs/adr/0024-visit-charges-in-the-completion-transaction.md`, new (W2, W20, W21, W23);
  - the ADR index;
  - CLAUDE.md §4 `billing` row: "clinical from 4a (reacts to `VisitCompleted` in the
    transaction)".

**`complete(id)`:**

```ts
return this.db.run(async () => {
  const snapshot = await this.visits.findById(id) ?? throw new VisitNotFoundError();
  await this.patients.lockForDependentWrite(snapshot.patientId);   // patient first (W24)
  const visit = await this.visits.lockLive(id);                      // then visit
  const services = await this.services.listForVisit(id);
  const money = visitMoney(services.map(toMoneyLine), visit.discountMode, visit.discountValue);
  const now = this.clock.now();
  const completed = await this.visits.update(id, { status: 'completed', completedAt: now,
    completedBy: this.context.requireUserId(), durationMinutes: durationMinutes(elapsedSeconds(visit, now)),
    pausedSeconds: /* + open pause */, pausedAt: null, subtotal: money.subtotal,
    discountAmount: money.discount, total: money.total });
  await this.audit.record({ action: 'visit.complete', ... });
  await this.events.publish(this.events.create(VISIT_COMPLETED,
    { visitId: id, patientId: visit.patientId, currency: visit.currency, total: money.total, localDate: visit.localDate }));
  return this.load(id);
});
```

- `publish` runs `billing`'s handler before this transaction commits.
- If `findById` and `lockLive` disagree on the patient (a merge re-pointed it in between),
  re-read the visit and retry once.

**`VisitChargeSubscriber`:**

```ts
@OnDomainEventInTransaction(VISIT_COMPLETED)
async onVisitCompleted(event: VisitCompleted): Promise<void> {
  if (isZero(event.payload.total)) return;                                  // W20
  const facts = await this.visits.chargeFacts(event.payload.visitId);       // same tx, sees the completion
  await this.billing.recordVisitCharge(facts);                              // internal: no payment:write (W2)
}
```

- `recordVisitCharge` is not exported from `billing`'s `index.ts`. It:
  - calls `lockForDependentWrite` (re-entrant, already held);
  - inserts the entry `{ kind: 'visit_charge', amount: total, currency, effectiveDate: localDate, visitId, createdBy: requireUserId() }`;
  - inserts the lines;
  - audits `ledger_entry.create`;
  - publishes `LedgerEntryRecorded` (after commit).
- A unique violation propagates (a bug; it rolls the completion back).

**`visitSummary(visitId)`** (`payment:read`):

- `visitMoney` (`visit:read`); a live visit → 409 `visit.not_live`.
- `charge` = the entry with this `visit_id`, else 0; `balance` = `balanceOf(patientId)` in the
  visit currency.
- `visit = { total: charge, paid: 0, outstanding: charge }`; `previous = balance − charge`;
  `totalOutstanding = balance`.

- [ ] **Integration tests first (`billing-visit-charge.int-spec.ts`):**
  - An examination-only visit completes with total 0 and no ledger entry; the summary is
    `0 / previous / previous`.
  - Two services and 10 % → one `visit_charge` equal to the total, 2 lines,
    `effective_date = local_date`, `created_by` = the completing user's auth id.
  - An opening balance of 40 plus this visit's 117 → summary `117 / 40 / 157`, equal to
    `balanceOf`.
  - **An assistant** (no `payment:write`) completes → the charge posts.
  - **Atomicity:** make the handler fail (a test-only provider override that throws after the
    insert) → `complete` fails, the visit stays live, and there is no entry.
  - Complete twice → 409 `visit.not_live`, still one entry.
  - Duration: 61 s → 2 minutes; paused time excluded.
  - `charged` in `balanceOf`.
  - The runtime role can't `UPDATE` or `DELETE` `ledger_entry_lines`.
  - Across visits: a plan recorded in visit 1 (completed) is performed in visit 2. The service
    carries `planId`, the plan has `performedInVisitId`, and the tooth history lists
    diagnosis → plan → service with both visit dates.
- [ ] **Implement, generate the three migrations, review, migrate the dev DB.**
- [ ] **Commit:** `feat(billing): post the visit charge in the completion transaction; visit summary`.

### Task E3: Clinical merge re-point

**Files:**

- `modules/clinical/application/merge-clinical.subscriber.ts`, new
  (`@OnDomainEventInTransaction(PATIENTS_MERGED)`).
- `modules/clinical/persistence/*.repository.ts`: `repointPatient(droppedId, keptId)` per
  table, plus `toothStatus.mergeInto(droppedId, keptId)`.
- Tests: `apps/api/test/integration/clinical-merge.int-spec.ts`, new.
- Docs:
  - `docs/modules/clinical.md` (consumes `PatientsMerged` in the transaction);
  - `patients.md` (consumers list);
  - CLAUDE.md §4 `clinical` row (tables; depends on patients, users, tenancy; reacts to
    `PatientsMerged`) and `patients` row (the dentition override).

**Handler, in order:**

1. `visits` (`update … set patient_id = kept where patient_id = dropped`).
2. `patient_diagnoses`.
3. `treatment_plans`.
4. `tooth_status`: delete the dropped rows whose position exists for the kept patient, then
   update the rest.
5. Audit `clinical.repoint` on the kept patient with the counts, when non-zero.

It isn't permission-gated (the merge needs `patient:write`; front desk may merge).

- [ ] **Integration tests first:**
  - Merging moves the visits, diagnoses, plans and tooth status; the kept patient's tooth
    status wins on a clash.
  - **Both patients have a live visit** → the kept patient has two live visits, both complete,
    and both charges land on the kept patient.
  - A handler failure (forced) rolls the merge back.
  - A merge by front desk succeeds.
  - A merge chain (A into B, B into C) → everything on C.
  - `billing`'s existing merge-ledger tests still pass.
- [ ] **Implement.**
- [ ] **Commit:** `feat(clinical): re-point visits and records in the merge transaction`.

---

## Step (f) — SPA foundations

### Task F1: Chart components and tooth labels

**Files (all under `apps/web/src/features/clinical/`):**

- `chart/use-chart-settings.ts`: reads `mode`, `notation` and `orientation` from the session
  tenant. `useToothLabel()` → `(code) => toothLabel(code, notation)`. `useToothName()` →
  a translated anatomical name.
- `chart/tooth-glyph.tsx`: surface grid (3×3, cells `size`, 1 px gap, the POC cell map from
  `surfaceCells`) or a single simple cell (`size × 2.2` by `size × 2.7`, radius
  `round(size × 0.34)`). Variants:
  - `chart` (12/8 px, not clickable cells);
  - `panel` (24 px, surfaces are buttons with letters and a `title` = full name + " · treated");
  - `history` (15 px, read-only).

  Primary teeth render at `max(6, round(size × 0.78))` inside a constant-height box.

- `chart/dental-chart.tsx`:
  - Props: `teeth: Map<ToothCode, ToothState>`, `dentition`, `toothStatus`, `size`,
    `selected?`, `onToothClick`.
  - Renders `archColumns(orientation)`, resolving each column with `presentTooth`.
  - Numbers sit above the upper arch and below the lower; the R/L markers follow the
    orientation.
  - `dir="ltr"` (W17); a horizontal scroll container; `role="group"` per arch with a label.
  - Each tooth is a button with `aria-label` = its title, `aria-pressed`.
  - The ring styles, the diagnosis dot and the muted italic number for not-erupted columns
    follow the spec.
- `chart/chart-legend.tsx`: the surface and simple legends.
- `chart/tooth-title.ts`: builds the title string from `ToothState` (i18n).
- `locales/{en,ar,fr}/clinical.json`, new namespace: tooth names, legend, states. Register it
  in `lib/i18n.ts`.
- Specs: `chart/dental-chart.spec.tsx`, `tooth-glyph.spec.tsx`, `tooth-title.spec.ts`.

- [ ] **Tests first:**
  - FDI vs Universal labels (`#16` ↔ `#3`, `55` ↔ `A`).
  - An 8-year-old renders `55` in column `15` and `16` in column `16`.
  - Orientation flips the column order and the R/L markers.
  - A treated surface only fills that cell; a whole-tooth service fills every cell.
  - The planned ring; the selected ring plus a bold number.
  - The diagnosis dot.
  - Simple mode renders one cell and the collapsed legend.
  - `aria-pressed` and the labels.
  - The container is `dir="ltr"` inside an RTL document.
- [ ] **Implement** (POC tokens from the existing Tailwind theme; no new palette).
- [ ] **Commit:** `feat(web): dental chart, tooth glyph and legend`.

### Task F2: Settings — dental chart section

**Files:**

- `apps/web/src/features/tenancy/tenancy-api.ts`: `useUpdateTenantSettings`, which patches
  `/tenant` and invalidates the session query. Reuse an existing tenant API helper if one
  exists (check `features/platform`).
- `apps/web/src/features/tenancy/chart-settings-section.tsx`, new:
  - three card groups (Chart detail, Notation, Orientation), each with a radio card, an
    In use / Not in use badge and a live preview (`chart/chart-preview.tsx`: four teeth for
    detail and notation, and the numbered row with R/L markers for orientation, per the POC);
  - the static Dentition explanation;
  - a toast on change;
  - disabled with a read-only note without `tenant:write`.
- `apps/web/src/routes/_app/settings.tsx`: render the section.
- `locales/{en,ar,fr}/settings.json`.
- `chart-settings-section.spec.tsx`.

- [ ] **Tests first:**
  - The owner switches the notation → PATCH is sent, the session is refetched, and the toast
    appears.
  - A dentist sees the cards disabled with the note.
  - The previews reflect each option.
- [ ] **Implement.**
- [ ] **Commit:** `feat(web): dental chart settings`.

---

## Step (g) — the workspace

### Task G1: Visits API, save groups and timer

**Files (`apps/web/src/features/clinical/`):**

- `visits-api.ts`: query keys `['visit', id]`, `['visits','live',filter]`,
  `['clinical','chart',patientId]` etc.; fetchers and mutations for every route in C2, D1, D2
  and E2.
  - Mutations that return `{ visit }` write it into `['visit', id]` with `setQueryData`.
  - Record mutations also invalidate `['clinical','chart',patientId]` and the history.
- `use-visit.ts`: the visit query with `refetchOnWindowFocus: true` and
  `refetchInterval: 10_000` only while no save group is dirty (W6; the groups report
  dirtiness through a small context).
- `use-save-group.ts`: a debounced (700 ms) mutation per field group, with state
  `idle | saving | saved | failed`.
  - On failure it keeps the local value and exposes `retry()`.
  - A server value never overwrites the local value while the group is dirty or saving.
  - It reuses `components/ui/save-state.tsx` for rendering.
- `use-visit-timer.ts`: `offset = serverNow − Date.now()` at fetch. It ticks every second only
  while `in_progress`, and formats `mm:ss` → `hh:mm:ss`.
- Specs for each.

- [ ] **Tests first:**
  - The save group debounces three edits into one call.
  - A failure shows `failed`, and retry re-sends the same value.
  - A refetch doesn't clobber a dirty field.
  - The timer freezes while paused and uses the server offset.
  - The refetch interval stops while a group is dirty.
- [ ] **Implement.**
- [ ] **Commit:** `feat(web): visit queries, autosave groups and timer`.

### Task G2: Workspace route, header, chart card, keyboard

**Files:**

- Routes:
  - rename `apps/web/src/routes/_app/visits.tsx` → `routes/_app/visits/index.tsx` (the
    placeholder is unchanged);
  - new `routes/_app/visits/$visitId.tsx`;
  - regenerate `routeTree.gen.ts` via the Vite plugin/dev server.
- `features/clinical/workspace/visit-workspace-page.tsx`:
  - the three bands (header, body with a wrapping left region and the aside, the financial
    bar);
  - loads the visit, the patient (`patients-api`) and the chart;
  - read-only when the user lacks `visit:write` (W18);
  - a completed visit redirects to the patient record.
- `workspace/visit-header.tsx`:
  - the patient chip (a link to the record);
  - alert chips;
  - the status and date block (the dentist name from the practitioners query);
  - the timer chip;
  - Pause/Resume;
  - a menu with **Discard visit** only while the visit is empty (derived client-side from the
    visit and the chart: no services, no records from this visit, no notes). It opens a confirm
    dialog, then calls `POST /discard` and returns to the record.
- `workspace/chart-card.tsx`:
  - the header, subtitle and legend;
  - a `DentitionSelect` ("Auto · Mixed (age 8)", Primary, Mixed, Permanent, Back to auto →
    `PUT /patients/:id/dentition` and a toast);
  - `DentalChart` with selection state.
- `workspace/use-chart-keyboard.ts`: ← → over `keyboardOrder(orientation)`, mapped through
  `presentTooth`. `Esc` closes the topmost layer, else deselects. Ignored while focus is in an
  input, textarea or select.
- Selection state (the selected tooth and pending surfaces) is local to the page. Selecting a
  tooth clears the surfaces (spec invariant 9).
- Specs: `visit-workspace-page.spec.tsx`, `use-chart-keyboard.spec.ts`,
  `visit-header.spec.tsx`.

- [ ] **Tests first:**
  - Keyboard walk and wrap in both orientations; ignored in a textarea; `Esc` deselects.
  - Pause/Resume calls and the chip styles.
  - Discard is shown only when empty; confirm → navigation.
  - Frontdesk sees no edit controls.
  - The dentition select raises the toast.
- [ ] **Implement.**
- [ ] **Commit:** `feat(web): visit workspace shell, header and chart card`.

### Task G3: Tooth panel and drawer

**Files (`features/clinical/workspace/`):**

- `tooth-panel/tooth-panel.tsx`:
  - the empty state;
  - the header with the enlarged glyph (surface toggles in surface mode), the number, the
    Upper/Lower label, the name and the hint line;
  - the planned strip;
  - `succession-row.tsx` (W5): predecessor/successor link and **Mark exfoliated** /
    **Still present** → `PUT /visits/:id/teeth/:position`, with the POC's toast; shown in mixed
    and primary stages, and in permanent when the predecessor has records;
  - three `panel-section.tsx` sections (collapsible, open by default, with collapsed
    summaries):
    - `diagnosis-section.tsx`: Resolve/Reopen, and Remove only for this-visit records;
    - `plan-section.tsx`: Perform now; Remove for this-visit plans, Cancel for older ones; the
      "One planned treatment performed" note;
    - `completed-section.tsx`: this-visit service cards with Base/Discount inputs (a save group
      per service) and Final; the "Previously" table; the "Full tooth history →" link; the
      empty block, suppressed when a service was added this visit.
- `catalog-drawer.tsx` + `drawer-list.ts` (pure grouping):
  - three modes with the spec's titles, placeholders and footers;
  - the target line; an autofocused search; category chips from the distinct categories;
  - "Frequently used" first (`frequent` flag);
  - per-tooth rows disabled without a tooth;
  - one click commits and closes;
  - toasts:
    - service added (+ Undo → `DELETE service`);
    - diagnosis recorded (+ **Plan treatment** → reopens in plan mode on the same tooth);
    - treatment planned.

  It uses `components/ui/right-panel.tsx` styled to 428 px, and the catalog queries from
  `features/clinical/catalog/catalog-api.ts` (active rows only).

- Perform now → a toast with Undo (→ `DELETE` the created service, which restores the plan).
- Specs: `tooth-panel.spec.tsx`, `catalog-drawer.spec.tsx`, `drawer-list.spec.ts`.

- [ ] **Tests first:**
  - Surface toggles build the pending scope, and adding clears it.
  - The collapsed summaries match the spec table.
  - Remove is only on this-visit records.
  - Perform → the note replaces the row; Undo restores it.
  - Drawer grouping: no query shows Frequently used then the categories; a query shows
    "`n` matches"; no results shows the copy.
  - Per-jaw rows are allowed without a tooth; per-tooth rows are disabled.
  - The diagnosis toast's action reopens in plan mode.
  - The succession row flips presence.
- [ ] **Implement.**
- [ ] **Commit:** `feat(web): tooth panel and catalog drawer`.

### Task G4: Plan board, notes, financial bar

**Files (`features/clinical/workspace/`):**

- `plan-board.tsx`:
  - open plans grouped by tooth (jaw last), each tooth column a link that selects it;
  - rows with Perform now;
  - the plan estimate;
  - the empty copy.
- `notes-card.tsx`: a textarea with the save group and the save-state indicator (V6).
- `discount-control.tsx`: the input plus the `% / $` segment. Shared with the summary dialog.
  One save group `discount`, keyed by visit, so both places edit the same state.
- `financial-bar.tsx`:
  - Services, Visit discount, Discount amount, Visit total;
  - the count line, **Save draft** (toast only) and **Review & complete**;
  - the cap warning (`flex: 1 0 100%; order: 9`);
  - `flex-wrap: wrap`; the buttons are `flex: none; white-space: nowrap`.
  - Figures use `visitMoney` from contracts on the current local values, so the preview
    matches the server exactly.
- Specs for each.

- [ ] **Tests first:**
  - The board groups and orders (jaw last), and Perform calls the route.
  - Notes autosave and the failed/retry path.
  - A 500 % or $500 discount shows the warning on its own line, keeps the typed value, and
    caps the total.
  - Non-numeric input is stripped.
  - Save draft shows its toast.
- [ ] **Implement.**
- [ ] **Commit:** `feat(web): plan board, clinical notes and financial bar`.

### Task G5: Start popover, live-visit pill, record header

**Files:**

- `features/clinical/start-visit-popover.tsx`:
  - anchored to the trigger;
  - Dentist (`GET /users/practitioners?branchId=<session branch>`) and Room
    (`GET /rooms?branchId=`, active only; hidden when there are none, W7);
  - defaults from `GET /visits/start-defaults`; the dentist is required;
  - submit → `POST /visits` → navigate to `/visits/$id` (no toast when `resumed`).
  - Error mapping: `visit.room_busy` → an inline room error; `visit.dentist_invalid` /
    `room_required` → field errors.
- `features/clinical/live-visit-pill.tsx`:
  - `GET /visits/live?mine=true` (polls every 30 s, refetches on focus);
  - hidden without `visit:write`;
  - one visit → a pill link with a pulsing dot, first name and running timer; several → a menu.
- `apps/web/src/shell/app-header.tsx`: render the pill.
- `features/patients/record/record-header.tsx`: **Start visit / Resume visit**
  (`visit:write`). Resume = `GET /visits/live?patientId=` → the most recently started one.
- The patient-created toast's **Start visit** action (from feature 3, if present) opens the
  popover.
- `locales/*/shell.json`, `patients.json`, `clinical.json`.
- Specs: `start-visit-popover.spec.tsx`, `live-visit-pill.spec.tsx`, `record-header.spec.tsx`
  (extend).

- [ ] **Tests first:**
  - The popover defaults: a dentist user is pre-selected; an assistant must pick; the room is
    hidden with no rooms.
  - A resumed start navigates without a toast.
  - `room_busy` shows the inline error.
  - The pill with one or two visits; hidden for frontdesk.
  - The header shows Resume when a live visit exists; frontdesk sees neither button.
- [ ] **Implement.**
- [ ] **Commit:** `feat(web): start visit popover, live visit pill and record header action`.

---

## Step (h) — completion and record views

### Task H1: Visit summary and post-visit summary

**Files (`features/clinical/dialogs/`):**

- `visit-summary-dialog.tsx`:
  - meta tiles (the duration is the live timer);
  - teeth treated, sorted by FDI code, as tooth labels;
  - services with targets;
  - the editable financial block via `DiscountControl` (live in both directions with the
    footer);
  - "Recorded for later" (diagnoses and plans with `recordedInVisitId = visit.id`);
  - notes;
  - footer: Continue editing, "Timer stops at mm:ss", **Complete visit**.

  Complete → `POST /visits/:id/complete` ("Recording…") → navigate to the patient record
  Overview (W16) → open the post-visit dialog with `visitId` in router state.

- `post-visit-summary-dialog.tsx`:
  - `GET /billing/visits/:id/summary`;
  - the header with a ✓, date · duration · n services, and a status pill (Unpaid when
    owing — feature 5 adds partial payment);
  - three blocks: This visit, Previous visits, Total outstanding;
  - the footer is **Pay later** / **Done**; **Record payment** is not rendered (feature 5).
- `features/patients/record/patient-record-page.tsx`: open the post-visit dialog from router
  state.
- `features/billing/billing-api.ts`: `useVisitSummary`.
- Specs for both dialogs.

- [ ] **Tests first:**
  - The discount edited in the dialog updates the footer's value (the same save group).
  - "Recorded for later" appears only with new records.
  - Complete navigates and opens the post-visit dialog.
  - The three figures render from the API, in `danger` or `success` by amount.
  - Done replaces Pay later when nothing is owed.
- [ ] **Implement.**
- [ ] **Commit:** `feat(web): visit summary and post-visit financial summary`.

### Task H2: Tooth history and Overview cards

**Files:**

- `features/clinical/dialogs/tooth-history-dialog.tsx`:
  - the 15 px glyph, title and name;
  - the three stages (badges, dates, prices, the service timeline);
  - the succession link;
  - the empty state with **Chart it in this visit** (when a visit is live for this patient) or
    **Start a visit** (the popover).

  It opens from the Overview chart, the plan board tooth links and "Full tooth history →".

- `features/patients/record/overview-tab.tsx`:
  - the **Dental status** card (a compact 8 px `DentalChart`, not selectable; a click opens the
    history);
  - the **Last visit** card (`GET /clinical/patients/:id/last-visit`: four facts, service chips
    `"<name> · <tooth label>"`, the note quote; "All visits →" is omitted until 4b);
  - the **Treatment summary** filled from `GET /clinical/patients/:id/summary` plus _Lifetime
    billed_ from `balanceOf(...).charged` (W8).
- `locales/*/patients.json`, `clinical.json`.
- Specs: `tooth-history-dialog.spec.tsx`, extend `overview-tab.spec.tsx`.

- [ ] **Tests first:**
  - The history orders diagnosis → plan → service with dates.
  - The empty-state action depends on a live visit.
  - The Overview shows the compact chart, the last visit and the counts; the last visit empty
    state.
- [ ] **Implement.**
- [ ] **Commit:** `feat(web): tooth history and overview chart, last visit and summary cards`.

---

## Step (i) — end to end and docs

### Task I1: Playwright, isolation and sweep

**Files:**

- `apps/web/e2e/visit.spec.ts`, new.
- `apps/api/test/integration/tenant-isolation-services.int-spec.ts`: `VisitsService.get`,
  `live`, `ChartService.*` and `BillingService.visitSummary` across tenants.
- A docs sweep for accuracy:
  - `docs/modules/{clinical,billing,tenancy,patients,users}.md`;
  - CLAUDE.md §4 (the `clinical`, `billing`, `tenancy` and `patients` rows), §7 (the `*_by`
    rule, W10) and §9 (checked);
  - the ADR index;
  - this plan (tick the boxes) and the spec's status line → "Implemented".

- [ ] **E2E flow:**
  1. The owner creates a patient with an opening balance of 40.
  2. **Start visit** (dentist and room) → select `#16` → add a diagnosis → take the toast's
     Plan treatment → perform now.
  3. Select another tooth, pick surfaces O and D, and add a service.
  4. Type a note → "Saved".
  5. Set a 10 % discount → Review & complete → Complete.
  6. The post-visit figures equal This visit / 40 / sum.
- [ ] **E2E resume:** start a visit, open a new browser context signed in as the same user, go
      to the record → **Resume visit** → the timer continues (within 2 s of the first context).
- [ ] **E2E notation:** switch Settings to Universal → the Overview chart labels `16` as `#3`;
      an 8-year-old shows `A` for `55`; overriding to Permanent changes the chart, not the
      records.
- [ ] **Full gate + `pnpm --filter @dcm/web e2e`** against the user's dev servers.
- [ ] **Commit:** `test(e2e): visit workspace flow; docs sweep`.
- [ ] **Final whole-branch review** (`superpowers:requesting-code-review`), then
      `superpowers:finishing-a-development-branch`.

---

## Coverage check

| Spec item                                          | Task               |
| -------------------------------------------------- | ------------------ |
| V1 canonical FDI, notation setting                 | A1, A4, F1, F2     |
| V2 dentition by age, per-patient override          | A1, B1, D2, G2     |
| V2/W5 per-position presence, succession row        | A1, D1, G3         |
| V3/W7 start popover, dentist and room              | B2, C2, G5         |
| V4/W1/W24 concurrency, lock order                  | C1, C2, E2, E3     |
| V5/W9–W11/W13 records on the tooth                 | C1, D1, D2         |
| V6/W6 server persistence, autosave, refetch, timer | C2, G1, G4         |
| V7/W2/W20/W21 money, charge, summary               | A2, E1, E2, H1     |
| V8/W18 permissions, read-only frontdesk            | C2, D1, G2, G5     |
| V9/W3/W17 settings, orientation, LTR chart         | A1, A4, F1, F2     |
| V10 events, merge re-point                         | C2, D1, E2, E3     |
| V11 `isInUse`                                      | D2                 |
| W4 discard                                         | C1, C2, G2         |
| W8 treatment summary                               | D2, E2, H2         |
| W10 actor columns = auth user id                   | C2, D1, E2, I1     |
| W12 one currency per visit                         | C1, D1             |
| W14 dentition permission                           | B1                 |
| W16 after-complete navigation                      | H1                 |
| W19 duration                                       | A2, E2             |
| W22 lock rename                                    | B1                 |
| W23 in-transaction handlers                        | E1                 |
| Tooth history, Overview cards                      | D2, H2             |
| Tenant isolation, Playwright, docs, ADRs 0021–0024 | A4, C2, D2, E2, I1 |
