# ADR-0107: What ends a waitlist entry

- Status: Accepted
- Date: 2026-11-19

## Context

The list must keep itself true: an entry never outlives its reason, and nobody has to clean it.
Nothing changes by itself (no job), and an entry is never deleted.

## Decision

1. An entry's stored status is `waiting`, `booked` or `removed`. **Expired is derived when read.**
   An entry with an appointment expires when that appointment is no longer booked or confirmed
   (checked in, started, completed, missed), or when its start has passed. An entry without one
   expires when today, in the clinic's zone, is after _Until_. The live query and the _Expired_
   filter both say this in SQL, so neither scans old rows in memory.
2. These rules run inside the transaction that sets them off. Each is audited with
   `actor_kind = 'system'` and the user whose action set it off (`AuditRecord.actorKind`):
   - a move re-points the entry (`waitlist_entry.follow`);
   - a booking that takes the entry's follow-up books the entry;
   - declining a follow-up removes its entry, while a follow-up that expires is only unlinked when
     read;
   - archiving a patient removes their entries, after `scheduling`'s veto;
   - a merge re-points entries and removes the newer of two without an appointment;
   - deactivating a dentist turns their named entries into _Any dentist_, after the veto;
   - Restore undoes the cancel tick (ADR-0103).
3. A person ends an entry by filling it, by removing it (with an optional reason), or by unticking
   _Wants an earlier time_.

## Consequences

- _Expired_ rows stay `waiting` in the table. That is why the one-of-each rule is the service's and
  not a unique index (ADR-0103).
- Rows never leave the table. The history filters (_Booked_, _Removed_, _Expired_) are paged by id.
