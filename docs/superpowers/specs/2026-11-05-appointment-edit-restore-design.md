# Edit and restore appointments; cancelled cards as a strip (feature 16)

Scheduling module only. ADR-0075. No migration: the columns exist.

## Decisions (user, 2026-11-05)

- **R1 Restore.** `cancelled → booked`, or `→ confirmed` when it had been confirmed (`confirmed_at` is
  kept on cancel). The same row: `cancel_reason`, `closed_by`, `closed_at` are cleared; the audit log
  keeps the history (`appointment.restore`). Open while the start is ahead (`canRestore`, contracts).
  `appointment:write` and the column rule, as Cancel.
- **R2 Placement.** As a move to the same time and dentist: an Auto room is chosen again, a room
  picked by hand that is now taken refuses (the user's choice), the patient booked elsewhere refuses;
  dentist and hours warnings need the override. The dentist must still be in the branch; the patient
  must be bookable (not archived or merged).
- **R3 Follow-up.** Still awaiting: booked again by this appointment. Otherwise (booked by another,
  declined, done) the restored appointment drops the link.
- **R4 API.** `POST /scheduling/appointments/:id/restore { override }`; `AppointmentRestored`. The
  alerts stream pings on it, as on a cancel.
- **R5 UI.** The cancelled appointment's popover has **Restore**: a dry run first; a hard conflict is a
  toast, warnings show inline with **Restore anyway** (override), none restores at once.
- **S1 Strip.** On the grid a cancelled card is a slim strip at the column's inline end (20%), hatched,
  initials struck through, a tooltip. Overlapping strips share it; an active card overlapping a strip
  in time leaves room for it. Cancelled cards take no lane and never join a week cluster. The rest of
  the slot books on click. The layout is a custom `dayLayoutAlgorithm` in `schedule-calendar.tsx`
  over the library's `no-overlap` (ADR-0071 stands: still the only file that knows the library).
- **E1 Edit button.** A pencil at the card's top inline-end corner, shown on hover and keyboard focus,
  always without hover (touch). Only where `abilities.edit` (= `move`: waiting, today or later, the
  caller's column). The card's button only, not the popover (the user, 2026-11-05). It opens the
  booking panel in edit mode.
- **E2 Edit panel.** Title "Edit appointment", patient fixed, no follow-up box, fields from the row;
  a duration off the chips gets its own chip; the live check ignores the row. "Confirmed with
  patient": ticked and locked when confirmed and not moving; unticks itself when the date, time or
  dentist changes (a moved appointment starts unconfirmed, feature 14), and may be ticked again.
- **E3 Save.** `PATCH /scheduling/appointments/:id`, `Idempotency-Key` required, body
  `{ reason, visitType, durationMin, dentistId, startsAt, roomId, confirmed, override }`; one
  transaction. Same start and dentist: the row changes in place (reason, type, end, room, booked →
  confirmed), `AppointmentEdited { changed }`, audit `appointment.edit`. Start or dentist changed: a
  reschedule (CLAUDE.md §8): the old row `rescheduled`, a new row in the lineage with the form's values,
  `booked` unless `confirmed`; the follow-up link moves; `AppointmentRescheduled`, audit
  `appointment.reschedule`. Same rules as move: `canMove`, start not in the past, both columns
  writable, hard conflicts refuse, warnings need the override. Kept time (review, 2026-11-05): the
  warnings it was booked through need no override again; the room choice may be `none`.

## Contracts

- `canRestore(moment, now)`: `cancelled` and `startsAt > now`.
- `restoreAppointmentSchema { override }`, `editAppointmentSchema` (fields above; `roomId` a room or
  `auto`).

## Tests

- Domain: the lifecycle table (`cancelled → booked | confirmed`). Contracts: `canRestore`.
- Web: the strip layout (`layOutLanes` / clusters ignore cancelled; the layout function's widths).
- Integration (`scheduling.int-spec.ts`): restore (status back, follow-up relinked or dropped, hand
  room taken refused, past refused); edit (in place, move makes a lineage row, idempotent replay).
- e2e (`appointments.spec.ts`): cancel → restore → edit the reason from the card's pencil.
