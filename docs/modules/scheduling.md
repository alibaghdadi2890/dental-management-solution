# `scheduling` module

**Status:** implemented for feature 14: calendar, booking, moving, check-in, follow-ups and the
worklist (ADR-0066 to ADR-0072); the waitlist for feature 21 (ADR-0103 to ADR-0107).

## Purpose

When patients are expected, and what comes next for each of them. **No patient leaves the clinic
without the next step being either booked or on someone's list.**

## Depends on

- `tenancy` (branches, rooms, time zone; `BranchCreated`)
- `users` (dentists of a branch, names; `StaffDeactivated`)
- `patients` (`refs`, `lockForBooking`; `PatientArchived`, `PatientsMerged`)
- `clinical` (`VisitFactsService.usualRoom`, `planStatuses`, `liveVisit`; the visit events)
- `audit`

`alerts` reads `AppointmentsService.todayBoard` and pings on `AppointmentCheckedIn`,
`AppointmentCheckInUndone`, `AppointmentCancelled` (feature 15) and `AppointmentRestored`
(ADR-0075); `notifications` will consume the events too.

## Tables (migration 0056)

| Table                  | What                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `appointments`         | branch, patient, dentist, room, `[starts_at, ends_at)`, status, reason, type, planned items, follow-up, lineage, who and when |
| `follow_ups`           | one per source visit: kind, title, plans, duration, timing, due date, `window_from`, notes, status, the will-call tag         |
| `branch_opening_hours` | seven rows per branch                                                                                                         |
| `scheduling_settings`  | one row per tenant at most: the follow-up window; none reads as 30                                                            |
| `waitlist_entries`     | migration 0063: a patient waiting for an earlier time for an appointment, or with none; wishes, urgent, last attempt, status  |
| `waitlist_left_open`   | migration 0063: freed appointments whose opening was left open (off Today and the dashboard)                                  |

`appointments.waitlist_entry_id` (0063) remembers the entry a row was booked or moved from.

Exclusion constraints `appointments_room_no_overlap` and `appointments_patient_no_overlap` cover the
active statuses (ADR-0067). They are written by hand in the migration.

## Rules

- **Conflicts:** room and patient are refused; dentist and hours need `appointment:override`.
- **Moving:** a new row in the lineage, status `booked`. A room from _Auto_ is chosen again, a room
  picked by hand stays and a clash refuses the move.
- **Editing (ADR-0075):** the Edit appointment panel's form, while it could move. The same start and
  dentist change the row in place (reason, type, end, room, confirming); another start or dentist is
  a move as above, with the form's values, unconfirmed unless _Confirmed with patient_ is ticked.
  Left on _Auto_ in place, the room it has stays while it is active and free; `none` keeps it without
  one. Keeping its time, it needs no override for the warnings it was booked through.
- **Restore (ADR-0075):** a cancelled appointment goes back to `confirmed` when it had been, else
  `booked`, on the same row, while its start is ahead. It is placed as a move to the same time; its
  follow-up is booked again when still awaiting, otherwise the link is dropped.
- **Follow-ups:** only cancel and no-show reopen one, and reopening restarts the window (ADR-0069).
- **Lab work as a reason:** the Next appointment step offers one _Fit …_ row per open lab order of
  the patient that no other appointment waits for (`labWorkForNextAppointment` in contracts), in the
  lab colour (`--color-lab*`). It is the kind `lab_work`, never a chip: it carries the order's plan
  items still open, 30 minutes, and _As soon as possible_ when the work is back or a custom date when
  it is expected back (at the lab: the trip's expected date; not sent or sent back: the visit's day
  plus the turnaround). The front desk's follow-up card shows the same _Lab work_ tag.
- **Time:** `check in` on the local day; `confirm` and `reschedule` from today on; `no-show` once the
  start has passed; `cancel` for anything booked or confirmed, past ones included.
- **Vetoes:** archiving a patient with upcoming appointments, `409 patient.has_upcoming_appointments`;
  deactivating a dentist with any open appointment, past or future,
  `409 staff.has_open_appointments`.
- **Merge:** of two overlapping appointments the waiting one is cancelled, reason "Duplicate after
  merge", and its follow-up reopens on the kept patient; the rest are re-pointed. Two that have both
  arrived refuse the merge, `409 patient.merge_appointments_in_progress`.

## Reactions, in the publisher's transaction

| Event                                      | Reaction                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `VisitStarted`, `VisitLinkedToAppointment` | → `in_room`; the wrong patient or an illegal transition vetoes the start |
| `VisitDiscarded`                           | `in_room` → `checked_in`                                                 |
| `VisitCompleted`                           | → `completed`, its follow-up → `done`, then the visit's own follow-up    |
| `PatientArchived`                          | veto, then declines awaiting follow-ups                                  |
| `PatientsMerged`                           | re-points, cancelling overlaps                                           |
| `BranchCreated`                            | seeds the hours                                                          |
| `StaffDeactivated`                         | veto                                                                     |

## HTTP (`/api/v1/scheduling`)

| Route                                                                                                                                  | Access                               |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `GET /appointments`, `GET /appointments/:id`, `POST /appointments/check`, `GET /slots`, `GET /resources`, `GET /today`                 | `appointment:read`                   |
| `GET /patients/:id/appointments`, `GET /patients/:id/follow-ups`, `GET /branches/:id/opening-hours`, `GET /settings`                   | `appointment:read`                   |
| `GET /patients/upcoming?patientIds=` (the search's next appointments, ADR-0102: each patient's first booked or confirmed one from now) | `appointment:read`                   |
| `POST /appointments`, `PATCH /appointments/:id`, `POST /appointments/:id/reschedule` (`Idempotency-Key`)                               | `appointment:write`, plus the column |
| `POST /appointments/:id/resize`, `/confirm`, `/check-in`, `/undo-check-in`, `/room`, `/cancel`, `/restore`, `/no-show`                 | `appointment:write`, plus the column |
| `GET /follow-ups`, `POST /follow-ups/:id/will-call`, `/decline`                                                                        | `appointment:write_all`              |
| `PUT /branches/:id/opening-hours`, `PUT /settings`                                                                                     | `tenant:write`                       |

The column rule is `canWriteAppointment` in `@dcm/contracts`: `appointment:write` is the caller's own
column and `appointment:write_all` every column. The service applies it on the source and the target.

## Events

`AppointmentBooked`, `AppointmentConfirmed`, `AppointmentCheckedIn`, `AppointmentCheckInUndone`,
`AppointmentRescheduled`, `AppointmentResized`, `AppointmentRoomChanged`, `AppointmentEdited`,
`AppointmentCancelled`, `AppointmentRestored`, `AppointmentMarkedNoShow`, `AppointmentStarted`, `AppointmentCompleted`, `FollowUpRecommended`,
`FollowUpBooked`, `FollowUpReopened`, `FollowUpTagged`, `FollowUpDeclined`, `OpeningHoursChanged`.
Every change also writes a dotted audit action for the Activity screen (area `schedule`).

`labs` consumes `AppointmentBooked`, `AppointmentRescheduled`, `AppointmentCancelled`,
`AppointmentMarkedNoShow` and `AppointmentCompleted` in the transaction to keep a lab order's
appointment link (ADR-0084), and reads `refs`, `upcomingFor` and `openWeekdays` (ungated building
blocks, feature 18). The booking warning about lab work is the SPA's (ADR-0081).

## The waitlist (feature 21)

Two kinds of entry in one list (ADR-0103): a patient with an appointment who wants an earlier time
(the _Wants an earlier time_ tick of New and Edit appointment, saved in that request), and a patient
with none (_Add to waitlist_: the Waitlist view, the slot finder, a follow-up, the record, the cancel
tick). One waiting entry per appointment and one without, checked under a per-patient lock.

- **Openings (ADR-0104)** are worked out when read (`domain/openings.ts`). A cancelled or moved row
  whose start is ahead frees its time. The opening is the dentist's free run around it, with at
  least 15 minutes of freed time: the opening hours as they are now, after now, minus the dentist's
  active appointments in any branch. Its id is its first freed appointment, plus an instant when
  the opening is split.
- **Who fits and the order (ADR-0105)**: `domain/waitlist-fit.ts`, `domain/waitlist-order.ts`
  (urgent, not tried today, longest wait). Lab work expected after the opening is the SPA's
  business: such entries are listed last with the lab mark.
- **Fill (ADR-0106)**: the existing move or booking, with `override: false`, under a per-dentist
  lock. The opening is worked out again (`409 waitlist.opening_taken`) and the entry is booked in
  the same transaction. It is idempotent by the key stored on the new appointment row.
- **What ends an entry (ADR-0107)**: it is filled, removed, or expired. Expired is derived: its
  appointment is no longer waiting ahead, or _Until_ has passed. Rules run in the transaction and
  are audited as the system's:
  - a move takes the entry along;
  - a booking that takes the entry's follow-up books it;
  - a declined follow-up, an archive and a merge's duplicate remove it;
  - a deactivated dentist's entries become _Any dentist_;
  - Restore undoes the cancel tick.
- Audit actions (area `schedule`):
  `waitlist_entry.add|update|no_answer|not_this_time|book|remove|follow|keep|any_dentist`,
  `waitlist_opening.leave_open`. No domain event is added: the fill publishes the booking's or the
  move's.

| Route                                                                              | Access                           |
| ---------------------------------------------------------------------------------- | -------------------------------- |
| `GET /waitlist` (`status`, `dentistId`, `appointment`, `fits`, cursor for history) | `appointment:write_all`          |
| `GET /waitlist/openings?branchId`, `GET /waitlist/openings/:appointmentId?at=`     | `appointment:write_all`          |
| `POST /waitlist/openings/:appointmentId/leave-open`, `POST /waitlist/:id/attempt`  | `appointment:write_all`          |
| `POST /waitlist/:id/fill` (`Idempotency-Key`)                                      | `appointment:write_all`          |
| `GET /patients/:id/waitlist`                                                       | `appointment:read`               |
| `POST /waitlist`, `PATCH /waitlist/:id`, `POST /waitlist/:id/remove`               | `appointment:write` + the column |

Changes to existing routes:

- `POST /appointments` gains `waitlist`: the tick's wishes.
- `PATCH /appointments/:id` gains `waitlist`; `null` removes the entry.
- `/cancel` gains `waitlist`: the tick.
- `SchedulingSummaryService.attention` gains `openingsToFill` for the dashboard; it is null without
  `appointment:write_all`.

## Summaries and the List view (feature 19)

`SchedulingSummaryService` (exported): appointments due (started by now; `rescheduled` rows
never count, their successor does) by outcome, week and dentist; room use against opening hours
× active rooms over the passed days (`domain/capacity.ts`, ADR-0090); busy hours (weekday ×
hour); follow-ups created in the span by state; needs attention (unresolved, overdue follow-ups,
patients with an accepted plan item and no upcoming appointment); check-in times for the waits.
Dashboard reads need `dashboard:operational`.

Routes added: `GET /scheduling/appointments/list` (`appointment:read`; dates, optional branch,
dentist, status incl. derived `unresolved`, weekday, hour, `due`; cursor-paged with a total) and
`GET /scheduling/patients?cohort=accepted_unbooked` (`patient:read`). Migration 0060 adds
`appointments_starts_idx`.
