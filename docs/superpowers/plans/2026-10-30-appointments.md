# Appointments — implementation plan

Spec: `docs/superpowers/specs/2026-10-30-appointments-design.md` (D1–D3, G1–G24). Prompt:
`16-appointments-prompt.md` (A1–A22).

Ground rules:

- Branch `feature/14-appointments`. Nothing is committed until the owner asks.
- Per task, run the affected tests and that package's typecheck. Task 22 runs the full lint, typecheck,
  tests, build and Playwright, then one review over the branch.
- Paths are under `apps/api/src/modules/` (API) or `apps/web/src/features/` (web) unless they start with
  `apps/`, `packages/` or `docs/`. Integration specs are in `apps/api/test/integration/`.
- New strings go to `apps/web/src/locales/{en,ar,fr}/` in the task that adds them.
- The app is live: migration 0056 only adds. Existing API shapes only gain optional or nullable fields.
- No queue, job or new Redis use.

## 0. Scheduler spike (ADR-0071)

Prove `react-big-calendar` 1.20 on a throwaway route before anything depends on it.

- Install it with `luxon` as a direct dependency. Tenant-zone localizer plus `getNow`.
- Must work:
  - resource columns in day, and days × dentists in week (`resourceGroupingLayout`);
  - drag between columns with a veto that snaps back;
  - bottom-edge resize only;
  - custom event card;
  - `slotPropGetter` shading per column;
  - RTL;
  - Vite 8 build, and the route-split chunk size noted.
- Done: each item confirmed, ADR-0071 drafted, throwaway route removed. **If an item fails, stop and
  report before Task 1.**

## 1. Contracts

- New `packages/contracts/src/scheduling.ts`: everything in the spec's Contracts section, with specs for
  `canWriteAppointment`, `proposeNextAppointment` and the due and expiry helpers. Export from the index.
- `permissions.ts`, `capabilities.ts` (group `schedule`, implies per G5).
- `audit.ts` (area `schedule`, prefixes).
- `visits.ts` (`appointmentId`, completion body).
- `patients.ts` (flag, `registrationIncomplete`, duplicate query per G2).
- `roles.json` labels in en/ar/fr so the capability spec passes.
- Done: contracts tests and typecheck green.

## 2. Migration and schema

- `scheduling/persistence/schema.ts`; `apps/api/migrations/0056_scheduling.sql`:
  - enums and four tables;
  - exclusion constraints and indexes;
  - RLS and runtime grants;
  - hours seeded for every branch;
  - `visits.appointment_id`, `patients.registration_incomplete`;
  - permissions per G5 on `role_permissions` and `role_template_permissions`, `ON CONFLICT DO NOTHING`.
- `roles/domain/system-roles.ts`, `docs/modules/roles.md` matrix.
- Done: migrates on a copy of the current schema; the RLS probe in `tenant-isolation.int-spec.ts` lists
  the new tables.

## 3. Domain

`scheduling/domain/`: `appointment-lifecycle`, `conflicts`, `slots`, `auto-room`, `follow-up-dates`, each
with exhaustive specs (adjacent, overlaps, midnight, Beirut DST, closed days, custom hours, past times,
grid alignment; G7 reopening).

- Done: unit tests green, no Nest or DB import.

## 4. Tenancy and settings

- `tenancy`: `BranchCreated` published in `createBranch`, exported from the index.
- `scheduling.module.ts`, app wiring. `OpeningHoursService`, `SchedulingSettingsService`, the routes,
  the `BranchCreated` seed.
- Done: a provisioned clinic and a new branch both have seven rows; `tenant:write` gate tested.

## 5. Patients

- `registration_incomplete` in schema, repository and read models.
- `create` with the flag requires a phone.
- `update` clears it per G3.
- `checkDuplicates` per G2.
- Done: integration tests for the three paths; existing patients suites green.

## 6. Clinical

- `visits.appointment_id`; `start` accepts `appointmentId`, including G9 on resume.
- `VisitStarted`, `VisitCompleted`, `VisitDiscarded` carry the new fields (spec Backend).
- New `VisitLinkedToAppointment`.
- `complete` takes the optional body.
- `usualRoom`, `planStatuses`, the live-visit read; export what `scheduling` needs from the index.
- Done: existing clinical and billing suites green; `clinical` imports nothing from `scheduling`.

## 7. Appointments writes

- `persistence/` repositories, `AppointmentsService`: `book`, `reschedule`, `resize`, `confirm`,
  `checkIn`, `undoCheckIn`, `changeRoom`, `cancel`, `markNoShow`.
- Permission checks, `Idempotency-Key`, `23P01` translation, events and audit per spec.
- Controller for these routes.
- Done: integration tests for concurrent booking (room, patient), override and its refusal, column
  permissions, a move and its lineage, a resize, idempotent retry.

## 8. Appointment reads

- `range`, `get`, `forPatient`, `nextForPatient`, `check`, `slots`, `todayBoard`, with the read model
  (names in batches, `lineage`, `unresolved`).
- Find or add a `users` read of names by auth user id for "Booked by".
- Done: integration tests for a range with a dentist taken off the branch, slots with
  `ignoreAppointmentId` and `includeWarnings`, the today sections.

## 9. Follow-ups and reactions

- `FollowUpsService`: `worklist`, `forPatient`, `markWillCall`, `decline`, booking link.
- In-transaction subscribers per the spec's table; D2 and G16 vetoes, G14, G15, A15 both branches.
- Done: integration tests for each row of the table, A15 atomicity (completion failure leaves the
  appointment), back to awaiting and its restarted window, no reopening on reschedule, a refused deactivation leaves
  the account active and signed in.

## 10. Audit and isolation

- Every action in the feed: `sentence.ts`, `activity.json`, `about()` checks, the Activity filter.
- `tenant-isolation-services.int-spec.ts`: every service and route.
- `docs/modules/scheduling.md`.
- Done: both isolation suites green; the API part is complete and typechecks.

## 11. Web foundation

- `scheduling-api.ts` (queries, mutations, invalidation), namespace `scheduling` in `lib/i18n.ts` and the
  i18next types.
- Route `/schedule`, nav item (`appointment:read`). Remove the "not part of phase 1" notes
  (`shell/nav-items.ts:11`, `routes/_app/index.tsx:5`).
- `use-schedule-display.ts` (G23), dentist colours from `MARK_COLORS` by staff order.

## 12. Calendar (A5)

- `schedule-page.tsx`, `schedule-calendar.tsx`, toolbar, day strip, filters, Display menu.
- Cards by duration per the design, current-time line, overflow, closed shading, grid bounds (G17),
  active dentists only (G16), `unresolved` filter.
- Done: acceptance _Calendar_; SPA spec for grid bounds.

## 13. New appointment panel (A11)

- Panel, patient search, quick create (G2), reason chips with type mapping, duration, dentist, date,
  time, Room Auto, live `check`, _Confirmed with patient_, _Book this follow-up_.
- Done: acceptance _Booking & conflicts_ and _Quick patient_; SPA spec for the disabled and warning
  states.

## 14. Popover (A7, A12)

- Popover content and actions by status and permission (G11, G12, G21), inline cancel, _Owes balance_
  (G19), Incomplete chip, _Registration incomplete · Complete now_.
- Done: acceptance _Unresolved & no-show_; SPA spec for the action matrix.

## 15. Drag, resize, move mode (A8, A9)

- Drop → `check` → confirmation → `reschedule` or `resize`; snap back on a hard conflict; override-gated
  _Move_.
- Move mode: bar, highlighted starts, warning style, keeps across days and views.
- Done: acceptance _Drag & resize_ and _Move mode_.

## 16. Slot finder (A10)

- Header, _Change dentist_, _Change dates_, _Open full calendar_, day rows with three spread chips and
  _+n more_, _Show more dates_, the empty and later-dates states, Confirm card, booked and taken states,
  G20 alert.
- Done: used from Task 17, 18 and 19 without change.

## 17. Complete dialog (A13, D1, A15)

- `useCompleteDialog`, Next appointment step, kind chips, timing, duration, _Dentist & notes_, _Book now_,
  _Send to front desk instead_, Skip, recap line, handoff.
- Wire `useFinishVisit` and `VisitSummaryDialog`. ADR-0065's check stays first.
- Done: acceptance _Dentist recommends_; SPA spec for the branching.

## 18. Checkout (A14)

- `PostVisitSummaryDialog` stepper, follow-up card, _Find available slots_, _Open full calendar_,
  _Not booking now_.
- Done: acceptance _Front desk books at checkout_; existing `checkout.spec.ts` green.

## 19. Today board (A16, A17)

- Today's schedule strip, Next appointment, Waiting, Coming up, Unresolved chip, Follow-ups to schedule,
  the checkout card's line.
- Done: acceptance _Worklist_.

## 20. Patient record and Start visit

- Next appointment card, Needs attention `followUp`, Incomplete chip, Complete registration.
- History timeline (A18).
- `StartVisitPopover` from an appointment (prefill, mapping) and _Link to today's {time} appointment_.
- Done: acceptance _Check-in → visit_ and _Patient record_.

## 21. Settings and docs

- Settings tab `schedule` (A19).
- Patient archive surfaces D2's 409; staff deactivation surfaces G16's.
- ADR-0066 to ADR-0072 and the ADR index.
- `clinical.md`, `patients.md`, `tenancy.md`; CLAUDE.md §4, §8, §12, §13.
- Done: acceptance _Permissions_; a changed rule is written down.

## 22. Verification

- Playwright: `appointments.spec.ts` with the three flows from the spec.
- Full lint, typecheck, tests, build, boundaries.
- RTL pass on the calendar and dialogs.
- One review over the branch; fix what it finds.
- Report to the owner, who commits.
