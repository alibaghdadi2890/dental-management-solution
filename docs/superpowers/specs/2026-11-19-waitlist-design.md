# Appointment waitlist — design

Written 2026-11-19 from the feature 21 prompt (`22-appointment-waitlist-prompt.md`). The clinic
keeps the patients who want an earlier appointment, or who have none; when booked time frees up,
the system says who fits it, a person calls, and one step books or moves the patient. It lives in
`scheduling`: no new module, no new dependency edge, no new permission, no job.

## Decisions

### Entries (ADR-0103, ADR-0107)

- **W1. One table, two kinds.** `waitlist_entries`: patient, branch, `appointment_id` (the
  appointment it brings forward) or none, `dentist_id` (null = _Any dentist_), the wishes
  (`weekdays smallint[]`, empty = any; `between_from`/`between_to`; `not_before`; `same_day`;
  `until_on` for an entry without an appointment), `urgent`, `note`, the reason, type, duration
  (default 30), planned items and follow-up of an entry without an appointment, the last attempt
  (`attempt_at`, `attempt_by`, `attempt_outcome`), `status` (`waiting | booked | removed`), who
  added it, who closed it and when, the removal reason, the appointment it was booked into, and
  `cancelled_appointment_id` + `cancel_created` (what the cancel tick did, so Restore can undo it).
  With an appointment the reason, type, duration, planned items and follow-up are read from the
  appointment, never stored twice.
- **W2. One waiting entry per appointment, one without.** Checked in the service under a
  per-patient advisory lock, not by a unique index: an expired entry stays `waiting` in the table
  (expiry is derived) and must not block a new one. Adding again answers
  `409 waitlist.entry_exists` with the existing id; the SPA opens that one instead.
- **W3. Expired is derived.** With an appointment: that appointment is no longer `booked` or
  `confirmed`, or its start has passed. Without: today (clinic time zone) is after `until_on`.
  Until for an entry without an appointment: 30 days ahead by default, at most 180.
- **W4. Rules, in the transaction that causes them, audited as the system's**
  (`actorKind: 'system'`, the user still recorded):
  - a move (reschedule, edit, fill) re-points the entry to the new row (`waitlist_entry.follow`);
  - a booking that takes an entry's follow-up closes it `booked` (`waitlist_entry.book`);
  - declining a follow-up removes its entry; an expired follow-up is only unlinked when read;
  - archiving removes the patient's waiting entries (after `scheduling`'s veto);
  - a merge re-points entries; of two waiting entries without an appointment the older stays, the
    other is removed; two for the same appointment cannot happen (one appointment, one patient);
  - a deactivated dentist's named entries become _Any dentist_ (after the veto).
- **W5. The cancel tick.** `POST /appointments/:id/cancel` gains `waitlist: boolean` (default
  false). Ticked: the appointment's entry, if any, becomes one without an appointment (its wishes,
  the appointment's dentist, reason, type, duration, planned items and follow-up, until 30 days
  ahead, `cancel_created = false`); with none, a new one is made the same way
  (`cancel_created = true`). If the patient already waits without an appointment, that entry stays
  and the appointment's entry is removed. Unticked: the appointment's entry is removed. Restore
  undoes it: a converted entry is the appointment's again, a created one is removed.
- **W6. The appointment remembers.** `appointments.waitlist_entry_id`: set on the row a fill
  creates. The read model gains `waitlist` (the appointment's waiting entry: id and wishes, or
  null) and `fromWaitlist`.
- **W7. The booking panels.** `POST /appointments` gains `waitlist?: Wishes` (the tick on New
  appointment), `PATCH /appointments/:id` gains `waitlist?: Wishes | null` (null unticks and
  removes; an object adds or changes the wishes; absent leaves it). Both in the booking's
  transaction, so the tick never half-saves.

### Openings and who fits (ADR-0104, ADR-0105)

- **O1. A freed slot** is a `cancelled` or `rescheduled` row whose start is ahead. **An opening**
  is a run of the dentist's free time (the branch's opening hours today, after now, minus every
  active appointment of the dentist in any branch) that holds at least 15 minutes of freed time.
  Its `freed` parts are the freed time inside it; its id is its first freed appointment id. It is
  computed when read (`domain/openings.ts`), never stored.
- **O2. Who fits** (`domain/waitlist-fit.ts`): every rule of B2. Candidate starts are each freed
  part's start and the 15-minute grid of the local day (`zonedInstant`, so DST holds); the span
  lies inside the opening, overlaps a freed part, and keeps the wishes. A fit row carries every
  valid start; the default is the freed slot's own start when valid.
- **O3. Order**: urgent, then not tried today, then created first (uuid v7 id breaks ties). An
  entry whose patient has lab work expected after the opening is moved last, with the lab mark
  and the warning, by the SPA, which owns that warning (ADR-0081); `scheduling` cannot read `labs`.
- **O4. Left open.** `waitlist_left_open` (freed appointment id, who, when): an opening is left
  open when every freed appointment in it is; a new cancellation joining it brings it back.
  _Leave open_ hides it from Today and the dashboard only.

### Filling (ADR-0106)

- **F1. `POST /scheduling/waitlist/:id/fill`** `{ openingId, startsAt, roomId?, confirmed }`,
  `Idempotency-Key` required. In one transaction: a per-dentist advisory lock, the entry
  (`waiting`, not expired), the opening recomputed (the span must still fit it, else
  `409 waitlist.opening_taken`), then the existing booking or move with `override: false` whoever
  asks, then the entry `booked` and the appointment's `waitlist_entry_id`. The key and its hash are
  stored on the appointment row the fill creates, as a booking's are.
  - With an appointment: the move (`moveRow`: lineage, follow-up, planned items, the lab link via
    `AppointmentRescheduled`), to the opening's dentist; a room picked by hand that is taken then
    is replaced by _Auto_'s choice.
  - Without: the booking with the entry's reason, type, duration, planned items, room _Auto_, and
    its follow-up when still awaiting and not expired.
- **F2. Refusals.** The dentist busy is the booking's conflict (`appointment.conflict`, kind
  `dentist`), shown as the slot finder's "just taken"; so is `waitlist.opening_taken`.

### Reads and routes (all under `/api/v1/scheduling`)

| Route                                                                   | Access                           |
| ----------------------------------------------------------------------- | -------------------------------- |
| `GET /waitlist?branchId&status&dentistId&appointment&fits&cursor&limit` | `appointment:write_all`          |
| `GET /waitlist/openings?branchId` (openings, fit counts, waiting count) | `appointment:write_all`          |
| `GET /waitlist/openings/:appointmentId` (one opening and who fits)      | `appointment:write_all`          |
| `POST /waitlist/openings/:appointmentId/leave-open`                     | `appointment:write_all`          |
| `GET /patients/:id/waitlist` (the patient's waiting entries)            | `appointment:read`               |
| `POST /waitlist`, `PATCH /waitlist/:id`, `POST /waitlist/:id/remove`    | `appointment:write` + the column |
| `POST /waitlist/:id/attempt` `{ outcome: no_answer \| not_this_time }`  | `appointment:write_all`          |
| `POST /waitlist/:id/fill` (`Idempotency-Key`)                           | `appointment:write_all`          |

The column for an entry: with an appointment, `canWriteAppointment` on it; without, the entry's
dentist (and _Any dentist_ needs `appointment:write_all`), before and after an edit. The waiting
list is one page (it is bounded: expired entries are left out); _Booked_, _Removed_ and _Expired_
are cursor-paged, newest first. The number to call (`callPhone`: the patient's phone, else the
primary guardian's) is filled only with `patient:read`.

The dashboard's `attention` gains `openingsToFill` (null without `appointment:write_all`): the
openings that someone fits and that are not left open, in the filter's branch (all branches
without one) and dentist. It links to Today.

### Screens

- **S1. Schedule › Waitlist.** The toolbar's switch reads _Day · Week · Waitlist n_ for
  `appointment:write_all`; `?view=waitlist` with `wstatus`, `wdentist`, `wappt`, `wfits` in the
  URL. The rows of C1; _Fits Tue 24 Nov · 15:00_ opens _Fill_; the row menu has _Find slots_,
  _Edit_, _Remove…_, _Open patient record_; _Add to waitlist_ in the header.
- **S2. Two panels over any page**, mounted once by the shell (`WaitlistProvider`, as Take out's):
  _Add to waitlist_ / _Edit waitlist entry_ (patient with the quick patient, dentist, reason chips,
  type, duration, wishes, urgent, note) and _Fill_ (the opening, its rows, the confirmation step,
  _No answer_, _Not this time_, _Remove…_). Opened from the view, Today, the calendar, a toast, the
  slot finder, the worklist, the checkout and the record.
- **S3. The tick.** New and Edit appointment gain _Wants an earlier time_ and the wishes under it
  (days, between, not before, same day, urgent; _Before {date}_ is read, never typed).
- **S4. Calendar.** A small mark on a card whose appointment waits for an earlier time (an arrow
  glyph, no text); the popover reads the wishes in one line. A cancelled card's popover offers
  _Fill from waitlist · n_. The cancel confirmation has the tick _Add to waitlist_. Toasts after a
  cancel or a move add _n on the waitlist fit_ with _Fill_ (only with `appointment:write_all`).
- **S5. Today.** _Openings to fill_ after the follow-ups: day and span, dentist, _n fit_, _Fill_,
  a menu with _Leave open_. Five rows, then _View all_ expands in place, as the worklist does.
  Polled every 30 s like the board.
- **S6. Record, follow-ups, finder.** The _Next appointment_ card reads _Wants an earlier time_ ·
  the wishes, or _On the waitlist · until {date}_ with _Edit_ and _Remove_, and offers _Add to
  waitlist_ when nothing is booked. An awaiting follow-up on the list carries _On the waitlist_ and
  its menus offer _Add to waitlist_. The slot finder's empty state and its links offer _Add to
  waitlist_ pre-filled; its confirmation and the New appointment panel show _On the waitlist ·
  Remove_ for a patient who waits without an appointment.

Explanations (what an opening is, why a row is last, why Until is read-only) sit behind the **!**.

## Out of scope

As the prompt lists: messages, automatic offers, self-service, holds, call logs, never-booked
time, slot-finder filters, dentist schedules, rooms as wishes, cross-branch entries, deposits,
no-show rules, waitlist reports, imports, assistant tools, restyling.
