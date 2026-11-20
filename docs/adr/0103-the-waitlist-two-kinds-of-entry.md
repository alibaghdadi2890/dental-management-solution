# ADR-0103: The waitlist: two kinds of entry in one list

- Status: Accepted
- Date: 2026-11-19

## Context

Feature 21 keeps two kinds of waiting patient: one with an appointment who wants an earlier time,
and one with no appointment because nothing suited. The front desk works them from one list, and a
cancellation can turn the first kind into the second. Feature 21 also says: no new module, no new
dependency edge, no new permission, and an entry is never deleted.

## Decision

1. The waitlist lives in `scheduling`, in one table, `waitlist_entries`. `appointment_id` says which
   kind an entry is. An entry with an appointment reads its reason, type, duration, planned items
   and follow-up from that appointment. An entry without one holds its own, with `until_on`. A check
   constraint ties the two: an entry has `appointment_id` or `until_on`, never both.
2. A patient has at most one waiting entry per appointment, and one without an appointment. The
   service checks this under a per-patient advisory lock, not with a unique index. Expiry is
   derived (ADR-0107), so an expired entry stays `waiting` in the table and must not block a new
   one. Adding a second entry answers `409 waitlist.entry_exists` with the first entry's id, and the
   SPA opens that one instead.
3. On an appointment, the entry comes from the _Wants an earlier time_ tick of New and Edit
   appointment. It is saved in the booking's own request and transaction (`waitlist` on
   `POST /appointments` and `PATCH /appointments/:id`), so the tick never half-saves. Unticking it
   removes the entry.
4. The entry follows its appointment. Every move (reschedule, edit, fill) re-points it to the new
   row in the transaction that inserts that row.
5. The cancel confirmation's _Add to waitlist_ tick (`waitlist` on `/cancel`). When ticked, the
   appointment's entry becomes one without an appointment (its wishes, the appointment's facts,
   until 30 days ahead). If there was no entry, a new one is made. `cancelled_appointment_id` and
   `cancel_created` remember which happened, so Restore can undo it: it gives a converted entry
   back to the appointment and removes a created one. If the patient already waits without an
   appointment, that entry stays and the appointment's entry is removed. When unticked, the
   appointment's entry is removed.
6. Access follows the appointment permissions (feature 21, _Access_). An entry with an appointment
   is that appointment's column (`canWriteAppointment`). An entry without one is the column of the
   dentist it names (`canWriteWaitlistEntry`). _Any dentist_ is every column, so it needs
   `appointment:write_all`. The list, the openings, the call outcomes and the fill need
   `appointment:write_all`. The number to call needs `patient:read`.

## Consequences

- Restore undoes only what the tick did. An entry removed by an unticked cancel stays removed. So
  does an entry closed because the patient already waited without an appointment.
- A merge needs one more rule: of two waiting entries without an appointment, the older one stays.
  Two entries for the same appointment cannot happen.
- The appointment read model gains `waitlist` (its waiting entry's wishes) and `fromWaitlist`. The
  follow-up read model gains `onWaitlist`.
