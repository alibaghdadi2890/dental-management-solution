# Appointments: calendar, booking, rescheduling, follow-ups — design

Date: 2026-10-30. Feature 14. New module `scheduling`; small additions to `clinical`, `patients`,
`tenancy`, `audit`, `contracts`; the SPA. ADR-0066 to ADR-0072. Migration 0056.

Source: the feature 14 prompt (`16-appointments-prompt.md`). Its decisions A1–A22, core model,
routes and acceptance stand unless this page says otherwise. Layout and copy come from the latest
design artifact (exported 2026-10-30, version `1793303275-e030`: `Schedule`, `FollowUpBooking`,
`Today`, `ClinicalWorkspace`). The prompt wins over the design where they differ. This page records
only what closes the prompt's gaps, plus the contracts.

**The rule:** no patient leaves the clinic without the next step being either booked or on someone's
list. G6 and G7 exist because the prompt's formulas alone would break this rule.

**Live deployment:** the migration only adds. No permission key is renamed, system roles only gain
permissions, and nothing a clinic has recorded is touched. No queue or job (no new Redis use).

## Facts checked against the code (2026-10-30)

| Prompt assumes                                  | Code says                                                                                                       | Resolved in |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------- |
| An existing tenancy event on branch creation    | None. `createBranch` only audits; provisioning calls `createBranch` too                                         | G1          |
| "The normal duplicate check" on quick create    | Advisory only, and `dateOfBirth` is required in its query (`findTwins`). `POST /patients` itself checks nothing | G2          |
| First name and last name fields                 | The patient has one `fullName`                                                                                  | G2          |
| "Required fields" clear the incomplete flag     | Only `fullName` is required. The "important" fields are `missingInformation()`                                  | G3          |
| Proposals need new `clinical` reads             | `chart.plans` already has status, priority, `estimatedSessions` and `sessions[]`; the visit page has it loaded  | G4          |
| A `write_all` role holds `write` by implication | `implies` is closed at write time, not at evaluation, so stored rows must be complete                           | G5          |
| `VisitStarted` always fires                     | `start()` resumes a live visit without an event, leaving an appointment stuck in _Arrived_                      | G9          |
| Front desk starts the visit from Waiting        | Front desk has no `visit:write` ("front desk starts no visit", `roles.md`)                                      | G10         |
| `btree_gist` needs adding                       | Already created (0053:3)                                                                                        | —           |
| Plan priorities as in the design (`routine`)    | `PLAN_PRIORITIES` = `urgent`, `high`, `elective`                                                                | G13         |

## Gaps closed

### The user's decisions (2026-10-30)

- **D1. Complete visit is two steps: Next appointment → Payment.** There is no Summary step, which
  amends A13 and keeps ADR-0065. The Complete step is the review, and so is the All view's Visit
  Summary. Each leads into the same dialog: the check before Complete (ADR-0065) runs first, then
  _Next appointment_, then completing, then _Payment_ or the handoff line. Checkout (A14) keeps its
  three steps.
- **D2. Archiving a patient with upcoming appointments is refused.** It answers 409
  `patient.has_upcoming_appointments`, naming the patient. `scheduling` vetoes in the transaction
  on `PatientArchived`. "Upcoming" is an active status with `starts_at >= now`; an unresolved past
  appointment does not block. A bulk archive is refused whole, as today.
- **D3. A moved appointment starts Unconfirmed.** The new row is `booked` whatever the old one was;
  the patient has not agreed to the new time. Resize keeps the status.

### Decided here

- **G1. Opening hours on a new branch.** Add `BranchCreated { branchId }`, published by
  `createBranch` inside its transaction. That covers provisioning too. `scheduling` seeds the seven
  rows in the transaction.
- **G2. Quick patient.** The panel shows _First name_ and _Last name_, split from the typed text
  (first token, rest) and joined into `fullName`. `POST /patients` gains
  `registrationIncomplete?: boolean`, default false; true requires a phone. The duplicate check
  becomes additive: `dateOfBirth` optional, `phone` added. With a date of birth it behaves as today.
  Without one it matches the same name or the same phone. Matches show inline and never block.
- **G3. Complete registration.** The flag clears in the same transaction as a patient save when
  `missingInformation()` comes back empty (date of birth, sex, a way to reach someone). Otherwise it
  stays, and the panel says what is still missing.
- **G4. Proposals are a pure function.** `proposeNextAppointment(plans, visitId)` lives in
  `contracts`, fed by the chart the page already holds; there is no new `clinical` read. `clinical`
  gains only `usualRoom` and `planStatuses` (Contracts).
- **G5. Stored role rows are the closure of A3.** dentist: `read`, `write`. assistant: `read`,
  `write`, `write_all`. frontdesk: `read`, `write`, `write_all`, `override`. owner and admin: all
  four. `CAPABILITY_IMPLIES`: `write`→`read`, `write_all`→`write`, `override`→`write`. `write_all`
  does not imply `override`.
- **G6. Rescheduling keeps the follow-up booked.** The prompt says both "the follow-up link moves to
  the new row" and "rescheduling-away sends it back to awaiting". The link moves, and "rescheduling-
  away" is dropped. Only cancel and no-show reopen a follow-up.
- **G7. Reopening restarts the window.** A follow-up due 1 Sep, booked for 15 Oct and cancelled on
  14 Oct would already be past expiry and leave the list unseen. So `window_from` starts as the due
  date (or the visit date) and moves to the reopen date when that is later. Expiry is computed at
  read: `window_from + the current window`. A Settings change therefore applies at once.
- **G8. Rooms on a move.** `room_auto` records that the room came from _Auto_. A move re-runs the
  Auto rule for an Auto room. A room picked by hand stays fixed, and a clash refuses the drop (A8).
  A dentist change alone keeps a fixed room.
- **G9. Resuming a visit links too.** `start()` with `appointmentId` on a resumed visit that has none
  sets it and publishes `VisitLinkedToAppointment`, so the appointment still reaches `in_room`.
- **G10. Start visit follows `visit:write`.** No matrix change. Front desk checks in; a dentist or
  assistant starts. The start reaction never applies `canWriteAppointment`: a colleague may start
  the visit. Its veto is the state machine and the patient match.
  _Since feature 15 (ADR-0074) Start visit follows `visit:start`, which the front desk holds._
- **G11. Undo check-in** is in the design and missing from the prompt. A mistaken check-in would
  otherwise be stuck, because `checked_in` cannot be cancelled. `checked_in → confirmed` clears the
  check-in. Audited, event `AppointmentCheckInUndone`.
- **G12. Room changes.** The prompt says "by editing" and lists no route. Add `POST …/:id/room`
  (body `{ roomId }`), with a _Change_ on the popover's room line. `check-in` takes an optional
  `roomId`, and the popover offers a room select when the appointment has none. Audited, event
  `AppointmentRoomChanged`. Reason and type are not editable after booking.
- **G13. Timing defaults** come from the design: unfinished work _Within 1 week_; plan items by
  priority (urgent ASAP, high 2 weeks, elective 1 month); others General 2 weeks, Healing 1 week,
  Consultation none, Routine examination 1 month, Other none. The dentist may tick several proposals
  as designed: title joined with " + ", durations summed, capped at 240. Default durations are the
  prompt's per-kind constants, not the design's per-service table. Custom timing is one date (prompt);
  the slot finder's _Change dates_ still takes a range.
- **G14. Merge.** `PatientsMerged` in the transaction: re-point the dropped patient's appointments and
  follow-ups. The patient exclusion constraint would fail on overlaps, so an overlap is settled first:
  a waiting dropped appointment is cancelled, reason "Duplicate after merge", and its follow-up reopens
  on the kept patient. If the dropped one has arrived and the kept ones are waiting, those are cancelled
  instead. If both have arrived the merge is refused, 409 `patient.merge_appointments_in_progress`: one
  visit has to end first. The D2 veto does not fire for a merge.
- **G15. Archive clears the list.** With no upcoming appointment left (D2), `PatientArchived` declines
  the patient's awaiting follow-ups, reason "Patient archived". Restoring does not revive them.
- **G16. A dentist with open appointments cannot be deactivated (the user's decision).** `scheduling`
  vetoes in the transaction on `StaffDeactivated`: 409 `staff.has_open_appointments`, with the count, if
  the staff profile has any appointment in an active status, past or future. An unresolved past
  appointment therefore blocks too, or it would be left on no column. Closed appointments and awaiting
  follow-ups do not block. The desk moves or closes them first. Calendar columns are the branch's active
  dentists, plus any active dentist with an appointment in the range (a dentist taken off the branch).
  A deactivated dentist has no column, so their closed appointments leave the calendar and stay on the
  patient record. New bookings and moves onto a dentist who is inactive or not in the branch answer 422
  `appointment.dentist_not_in_branch`. A follow-up whose preferred dentist is gone opens the slot finder
  on _Change dentist_.
- **G17. Grid bounds** are the opening hours of the visible days united with the appointments in the
  range, or an override at 18:30 could not be seen. With every visible day closed: 08:00–18:00.
- **G18. Follow-ups belong to the source visit's branch.** The worklist shows the shell's branch only.
  The slot finder books in the shell's branch.
- **G19. _Owes balance_ stays out of the backend.** The SPA reads the existing patient balance when the
  popover opens, with `payment:read`. `scheduling` does not depend on `billing` (A1).
- **G20. A cancelled plan item.** Reads of a follow-up carry `invalidReason` (`plan_cancelled`,
  `plan_done`) from `planStatuses`. The slot finder shows the design's "Check with {dentist} before
  booking" and still allows it. The worklist row stays.
- **G21. Past appointments.** Check in: the local day only. Confirm and Reschedule: from today on.
  Mark no-show and Cancel: any booked or confirmed appointment whose start has passed, on any day, or
  old unresolved ones could never be cleared. The Today chip counts today only. Cancel also applies
  to future booked and confirmed ones.
- **G22. Visit void and correction** do not touch appointments or follow-ups. A completed appointment
  stays completed, and a follow-up from a voided visit stays until the desk declines it.
- **G23. Slot length is per user:** storage key `dcm.scheduleDisplay.<userId>`, unlike the chart
  view's single key. It also sets the panel's default duration, as designed.
- **G24. Where the prompt overrides the design.** Cancelled cards stay struck through (A12).
  _Auto_ with no free room books without one. A follow-up is never "superseded"; a later visit adds
  its own row.
- **G24a. Week view follows the design, not A5** (the user's decision, 2026-10-31, after seeing days ×
  dentists built: too tight, no border between days). One column per day, every shown dentist in it.
  A card carries its dentist's colour, and initials when more than one is shown. Three or more
  overlapping lanes collapse into one card (count, how many in clinic, time range, first names) that
  opens the Day view, as does a day's header. A card dragged in the week keeps its dentist; to change
  dentist, use the Day view. An empty slot opens the panel on the filtered dentist, or asks for one.
  Day view keeps one column per dentist. Lunch and "off" labels stay out: availability is the branch's
  opening hours (ADR-0068).

## State machine

```
booked     → confirmed, checked_in, in_room, cancelled, no_show, rescheduled
confirmed  → checked_in, in_room, cancelled, no_show, rescheduled
checked_in → confirmed (undo), in_room
in_room    → checked_in (discard), completed
completed, cancelled, no_show, rescheduled: terminal
```

`in_room` from `booked` or `confirmed` stamps the check-in (implicit check-in). `unresolved` is derived:
status `booked` or `confirmed` and `ends_at < now`.

## Data (migration 0056, additive)

Enums `appointment_status`, `follow_up_status` (`awaiting`, `booked`, `declined`, `done`). All new
tables: `tenant_id`, RLS, runtime grants. Cross-module references are plain uuids.

- **`appointments`:** `id, branch_id, patient_id, dentist_id, room_id?, room_auto, starts_at, ends_at,
status, reason, visit_type?, plan_ids uuid[], follow_up_id?, source_visit_id?, lineage_id,
overridden text[], booked_by, confirmed_by?/at?, checked_in_by?/at?, closed_by?/at?, cancel_reason?,
idempotency_key?, idempotency_hash?, created_at, updated_at`.
  - `CHECK (ends_at > starts_at)`.
  - Active = `booked, confirmed, checked_in, in_room`.
  - `appointments_room_no_overlap`: `EXCLUDE USING gist (room_id WITH =, tstzrange(starts_at, ends_at)
WITH &&) WHERE (active AND room_id IS NOT NULL)`. `appointments_patient_no_overlap` likewise on
    `patient_id`.
  - Indexes `(branch_id, starts_at)`, `(dentist_id, starts_at)`, `(patient_id, starts_at)`,
    `lineage_id`, `source_visit_id`. Partial unique: `idempotency_key`; `follow_up_id` where active.
- **`follow_ups`:** `id, branch_id, patient_id, source_visit_id UNIQUE, source_visit_number,
recommended_by (staff profile), preferred_dentist_id?, kind, title, plan_ids uuid[], priority?,
session_number?, session_total?, duration_min, timing, custom_date?, visit_date, due_on?, window_from,
note?, clinical_prep?, status, will_call_by?/at?, declined_by?/at?, declined_reason?, created_by,
created_at, updated_at`. Indexes `(status, due_on)`, `patient_id`.
- **`branch_opening_hours`:** `branch_id, weekday (0–6), is_open, from_time, to_time`, PK
  `(branch_id, weekday)`, `CHECK (NOT is_open OR from_time < to_time)`. Seeded Mon–Sat 08:00–18:00,
  Sunday closed, for every branch.
- **`scheduling_settings`:** `tenant_id` PK, `follow_up_window_days` (1–365). No row reads as 30.
- **`visits.appointment_id`** uuid, nullable (no query reads visits by it, so no index). **`patients.registration_incomplete`** boolean,
  default false.
- Permissions per G5: `role_permissions`, `role_template_permissions`, `ON CONFLICT DO NOTHING`; admin
  on every clinic (ADR-0061); owner rows too; `SYSTEM_ROLES`.

## Contracts (`packages/contracts`)

New `scheduling.ts`:

- `appointmentSchema`: the row plus `patient { id, fullName, displayNumber, registrationIncomplete }`,
  `dentistName`, `roomName?`, `followUp? { id, title, sourceVisitNumber, recommendedByName }`,
  `lineage { moves, firstStartsAt, movedToStartsAt? }`, `bookedByName`, `unresolved`.
- Inputs:
  - `bookAppointmentSchema` `{ branchId, patientId, dentistId, startsAt, durationMin (5–480), reason,
visitType?, roomId: uuid | 'auto', confirmed, followUpId?, sourceVisitId?, override? }`.
  - `rescheduleAppointmentSchema` `{ startsAt, dentistId?, roomId?: uuid | 'auto', override? }`.
  - `resizeAppointmentSchema` `{ durationMin, override? }`.
  - `cancelAppointmentSchema` `{ reason? }`. `checkInSchema` `{ roomId? }`.
- `appointmentCheckSchema` `{ branchId, dentistId, patientId?, startsAt, durationMin, roomId,
ignoreAppointmentId? }` → `{ conflicts: AppointmentConflict[], room { roomId?, usualRoomId?,
isUsual } }`.
- `AppointmentConflict`: `{ kind: 'room' | 'patient' | 'dentist' | 'outside_hours' | 'closed_day',
hard, … }`. `room` and `patient` are hard. A 409 body lists them.
- `slotQuerySchema` adds to A10 `stepMin`, `ignoreAppointmentId?`, `includeWarnings?`; the range is at
  most 62 days. `slotDaySchema`: `{ date, slots: [{ startsAt, endsAt, roomId?, usualRoomId?, isUsual,
warnings[] }] }`. `includeWarnings` adds soft-conflict starts for move mode.
- `followUpSchema` with derived `expiresOn`, `expired`, `overdueDays`, `invalidReason`.
- `nextAppointmentPayloadSchema`: `{ kind, title, planIds, priority?, sessionNumber?, sessionTotal?,
durationMin (5–240), timing, customDate?, preferredDentistId?, note?, clinicalPrep?,
bookedAppointmentId? }`. With `bookedAppointmentId` the follow-up is created `booked`. A completion
  with no payload is Skip.
- `openingHoursSchema`, `schedulingSettingsSchema`, `todayBoardSchema`.
- Pure helpers:
  - `canWriteAppointment(session, { dentistId })`.
  - `FOLLOW_UP_KINDS` with default duration, timing and visit type; the reason chips with their type.
  - `followUpDueOn`, `followUpExpiresOn`.
  - `proposeNextAppointment` (G4).

Additive elsewhere: `permissions.ts`, `capabilities.ts` (group `schedule`), `audit.ts` (area `schedule`,
prefixes `appointment`, `follow_up`, `opening_hours`), `visits.ts` (`appointmentId` on the start input
and the visit; optional completion body), `patients.ts` (G2, the flag on `patientSchema` and
`patientListItemSchema`).

## Backend

`scheduling` follows the module layout. `domain/` is pure:
`appointment-lifecycle.ts`, `conflicts.ts`, `slots.ts`, `auto-room.ts`, `follow-up-dates.ts`. The slot
search takes opening intervals minus a list of busy-interval lists, so dentist availability is later
one more list.

Depends on: `tenancy`, `users`, `patients`, `clinical`, `audit`. Nothing imports it.

**Writes.** One transaction. Lock the follow-up `FOR UPDATE` when there is one (409
`follow_up.not_awaiting` if it is no longer awaiting, the design's "someone else booked it"). Compute
conflicts; a soft conflict without `override` and without `appointment:override` → 409
`appointment.conflict`; with it, store the kinds in `overridden`. Insert. Translate an exclusion
violation (`23P01`, by constraint name) into `appointment.conflict`, so a race answers the same way;
for _Auto_, retry the room choice once. `canWriteAppointment` on the source and on the target column.
`Idempotency-Key` on book and reschedule: key and hash on the row, the template of `patients` and
`ledger_entries` (ADR-0037).

**Reschedule.** In one transaction: old row → `rescheduled`, new row with the same `lineage_id`, the
`follow_up_id`, `plan_ids`, `reason`, `visit_type`, `source_visit_id`, and the same duration. The old
row is updated first so the constraints do not clash.

**In-transaction reactions.**

| Event                                                              | Reaction                                                                                       |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `VisitStarted` / `VisitLinkedToAppointment` (with `appointmentId`) | → `in_room`; 422 `appointment.not_for_patient`, or the transition error, vetoes                |
| `VisitDiscarded`                                                   | `in_room` → `checked_in`                                                                       |
| `VisitCompleted`                                                   | → `completed`, its follow-up → `done`; then creates the follow-up from `nextAppointment` (A15) |
| `PatientArchived`                                                  | D2 veto, then G15                                                                              |
| `PatientsMerged`                                                   | G14                                                                                            |
| `BranchCreated`                                                    | G1                                                                                             |
| `StaffDeactivated`                                                 | G16 veto                                                                                       |

A `bookedAppointmentId` that is not this visit's appointment vetoes the completion. One whose
appointment was cancelled since creates the follow-up as `awaiting`.

`clinical` gains:

- `appointmentId` on start, on the visit, on `VisitStarted`, `VisitCompleted` and `VisitDiscarded`.
- On `VisitCompleted` also `branchId`, `displayNumber` and `nextAppointment`, which it never reads.
- `POST /visits/:id/complete` takes the optional body. Import stays as it is: no event, no appointment.
- `VisitFactsService.usualRoom(dentistId, branchId, since)`: the room of most of the dentist's visits
  in the branch since that date, ties to the most recent.
- `planStatuses(planIds)`, and a read of a live visit for `sourceVisitId`.

**Routes.** The prompt's route table, plus `POST …/:id/undo-check-in` and `POST …/:id/room`. `GET /scheduling/today`
returns the day's board. Follow-ups are always on their own route, so the section follows `write_all`.

**Audit.** Explicit `audit.record` with dotted actions (`appointment.book`, `.reschedule`, `.resize`,
`.confirm`, `.check_in`, `.undo_check_in`, `.room`, `.cancel`, `.no_show`, `.start`, `.complete`,
`follow_up.recommend`, `.book`, `.reopen`, `.will_call`, `.decline`, `opening_hours.update`,
`scheduling_settings.update`), each with `about()` the patient, and the visit when there is one. The
generic subscriber only logs event rows; the feed needs these. Sentences in `sentence.ts`, strings in
`locales/*/activity.json`.

## Frontend

- `features/scheduling/`, route `/schedule` (`date`, `view`, `dentist`, `room`, `unresolved`,
  `appointment` in the URL). Lazy-loaded: the scheduler is the app's largest dependency.
- Scheduler: `react-big-calendar` 1.20 (MIT, React 19 peer range confirmed) behind one
  `schedule-calendar.tsx`. Task 0 proves it before anything else depends on it (ADR-0071).
- Slot finder, New appointment panel (`RightPanel`), popover (Radix `Popover`, inline Cancel) and
  move-mode bar are their own files.
- `useCompleteDialog` replaces the direct completion in `useFinishVisit` and the Complete button of
  `VisitSummaryDialog`. It holds the Next appointment step. `PostVisitSummaryDialog` gets the stepper:
  Next appointment ✓ · Payment after completing, Summary · Next appointment · Payment at checkout.
- A reopened Complete dialog finds an appointment already booked from this visit by `sourceVisitId`
  and shows the booked state (A15).
- The Today board composes `/scheduling/today`, the follow-ups route and the existing checkout queue,
  on the 30-second poll. `needsAttention()` gains kind `followUp`. `HistoryTab` merges appointments and
  follow-ups into the visits timeline by date; `visit.appointmentId` folds the pair.
- Settings tab `schedule` with `SaveBar`. `branches` come from the session.
- Namespace `scheduling` in en/ar/fr, RTL on the grid, `formatTime` for every time.

## Testing

Per the lean process:

- Domain unit tests: every legal and illegal transition; conflicts; slots (DST, closed days, past,
  grid); Auto room; due and expiry including G7.
- Contract tests: `proposeNextAppointment`, `canWriteAppointment`.
- Integration: exclusion constraints under concurrent booking, the event reactions, A15 atomicity,
  back-to-awaiting, D2, G14, idempotency. One route smoke per area.
- Tenant isolation: both suites, every new table and route.
- Playwright: phone booking through checkout booking; drag and resize; the worklist.
- SPA specs only where there is logic: conflict display, dialog branching, role gating, grid bounds.

## ADRs

0066 scheduling module and appointment lifecycle · 0067 conflicts (hard room and patient, soft dentist
and hours; amends CLAUDE.md §8) · 0068 opening hours as the only availability, materialisation
deferred · 0069 follow-ups: due, window, derived expiry, reopening · 0070 quick patients and incomplete
registration · 0071 the scheduler component · 0072 completion carries the next-appointment payload (and
the two-step dialog, amending ADR-0065's flow).

CLAUDE.md: §4 (module map; `patients`, `clinical`, `tenancy` rows), §8 (conflicts, availability,
durations not from the catalog, no resource table), §12 (`Idempotency-Key` list), §13 (scheduler).
