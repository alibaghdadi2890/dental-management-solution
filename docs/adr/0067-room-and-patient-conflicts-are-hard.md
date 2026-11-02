# ADR-0067: Room and patient conflicts are hard, dentist and hours are soft

- Status: Accepted
- Date: 2026-10-30
- Amends: CLAUDE.md §8

## Context

CLAUDE.md §8 said double booking is prevented by an exclusion constraint on every resource. Clinics
do overlap a dentist on purpose (a short check between two patients), and an appointment outside the
hours is sometimes right.

## Decision

1. Same room or same patient, overlapping, is refused by exclusion constraints on `tstzrange`, over
   the active statuses. A race answers `409 appointment.conflict` like any other conflict; _Auto_
   chooses its room again once first.
2. Same dentist, and outside the opening hours or on a closed day, are warnings. Booking through one
   needs `appointment:override` and the request's `override` flag, and the row records which warnings
   it went through.
3. One pure function evaluates conflicts for the panel, the drag, move mode and the save.
4. Adjacent appointments do not conflict: spans are half-open.

## Consequences

- Dentist overlaps are not protected from a race. A warning that two people miss at the same moment
  is acceptable; the calendar shows both.
