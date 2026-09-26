# ADR-0001: `clinical` replaces `treatments` and owns visits

- Status: Accepted
- Date: 2026-09-26

## Context

Phase 1 must "create and manage visits". The original module map had no visit owner: `scheduling`
owns appointments and `treatments` owned "clinical charting linked to visits". The design POC treats
a visit as a clinical encounter (services performed with teeth, notes, totals, amend/void with
reason) distinct from an appointment on the calendar.

## Decision

Rename `treatments` to `clinical`. `clinical` owns visits (encounters), treatment plans, planned
procedures and charting. An appointment is a calendar reservation in `scheduling`; a visit may
reference the appointment it came from, but `clinical` never imports `scheduling`.

## Consequences

- Visits can ship in phase 1 without the scheduling module.
- Imported service history becomes historical visits in `clinical`.
- `billing` depends on `clinical` instead of `treatments`.
