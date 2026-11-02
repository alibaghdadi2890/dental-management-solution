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

Nothing imports `scheduling`. Its events have no consumer yet; `notifications` will.

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
| `POST /appointments` and `POST /appointments/:id/reschedule` (`Idempotency-Key`)                                       | `appointment:write`, plus the column |
| `POST /appointments/:id/resize`, `/confirm`, `/check-in`, `/undo-check-in`, `/room`, `/cancel`, `/no-show`             | `appointment:write`, plus the column |
| `GET /follow-ups`, `POST /follow-ups/:id/will-call`, `/decline`                                                        | `appointment:write_all`              |
| `PUT /branches/:id/opening-hours`, `PUT /settings`                                                                     | `tenant:write`                       |

The column rule is `canWriteAppointment` in `@dcm/contracts`: `appointment:write` is the caller's own
column and `appointment:write_all` every column. The service applies it on the source and the target.

## Events

`AppointmentBooked`, `AppointmentConfirmed`, `AppointmentCheckedIn`, `AppointmentCheckInUndone`,
`AppointmentRescheduled`, `AppointmentResized`, `AppointmentRoomChanged`, `AppointmentCancelled`,
`AppointmentMarkedNoShow`, `AppointmentStarted`, `AppointmentCompleted`, `FollowUpRecommended`,
`FollowUpBooked`, `FollowUpReopened`, `FollowUpTagged`, `FollowUpDeclined`, `OpeningHoursChanged`.
Every change also writes a dotted audit action for the Activity screen (area `schedule`).
