# `scheduling` module

**Status:** implemented for feature 14: calendar, booking, moving, check-in, follow-ups and the
worklist (ADR-0066 to ADR-0072).

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

| Route                                                                                                                  | Access                               |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `GET /appointments`, `GET /appointments/:id`, `POST /appointments/check`, `GET /slots`, `GET /resources`, `GET /today` | `appointment:read`                   |
| `GET /patients/:id/appointments`, `GET /patients/:id/follow-ups`, `GET /branches/:id/opening-hours`, `GET /settings`   | `appointment:read`                   |
| `POST /appointments`, `PATCH /appointments/:id`, `POST /appointments/:id/reschedule` (`Idempotency-Key`)               | `appointment:write`, plus the column |
| `POST /appointments/:id/resize`, `/confirm`, `/check-in`, `/undo-check-in`, `/room`, `/cancel`, `/restore`, `/no-show` | `appointment:write`, plus the column |
| `GET /follow-ups`, `POST /follow-ups/:id/will-call`, `/decline`                                                        | `appointment:write_all`              |
| `PUT /branches/:id/opening-hours`, `PUT /settings`                                                                     | `tenant:write`                       |

The column rule is `canWriteAppointment` in `@dcm/contracts`: `appointment:write` is the caller's own
column and `appointment:write_all` every column. The service applies it on the source and the target.

## Events

`AppointmentBooked`, `AppointmentConfirmed`, `AppointmentCheckedIn`, `AppointmentCheckInUndone`,
`AppointmentRescheduled`, `AppointmentResized`, `AppointmentRoomChanged`, `AppointmentEdited`,
`AppointmentCancelled`, `AppointmentRestored`, `AppointmentMarkedNoShow`, `AppointmentStarted`, `AppointmentCompleted`, `FollowUpRecommended`,
`FollowUpBooked`, `FollowUpReopened`, `FollowUpTagged`, `FollowUpDeclined`, `OpeningHoursChanged`.
Every change also writes a dotted audit action for the Activity screen (area `schedule`).
