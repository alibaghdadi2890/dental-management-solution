# `alerts` module

**Status:** implemented for feature 15: arrival alerts (ADR-0073, ADR-0074). Spec
`docs/superpowers/specs/2026-11-03-arrival-alerts-design.md`.

## Purpose

Tell the people who run visits, the moment it happens, that one of their dentists' patients has
arrived or is in a room, and take them there in one click.

## Depends on

- `scheduling` (`AppointmentsService.todayBoard`; `AppointmentCheckedIn`,
  `AppointmentCheckInUndone`, `AppointmentCancelled`)
- `clinical` (`VisitsService.liveOfDentists`; `VisitStarted`, `VisitPaused`, `VisitResumed`,
  `VisitDiscarded`, `VisitCompleted`)
- `users` (the active dentists)
- `audit`

Nothing imports `alerts`.

## Tables (migration 0057)

| Table           | What                                                                                  |
| --------------- | ------------------------------------------------------------------------------------- |
| `alert_follows` | who (auth user id) follows which dentist (staff profile id); a junction, hard-deleted |

## Public API

| Route                 | Access        | What                                                                          |
| --------------------- | ------------- | ----------------------------------------------------------------------------- |
| `GET /alerts/tray`    | `visit:write` | `waiting`, `inRoom`, `follows`, `serverNow`: "Your patients"                  |
| `PUT /alerts/follows` | `visit:write` | the whole set of followed dentists; others than oneself need `visit:read_all` |
| `GET /alerts/stream`  | `visit:write` | server-sent events: `tray` (refetch), `ping` every 25 s                       |

## Rules

- **The caller's dentists** are their own staff profile (when they practise) and whom they follow,
  less any who left. `waiting` is today's checked-in appointments of the session's branch for them,
  with `appointment:read`. `inRoom` is their live visits and those the caller started, within the
  caller's visit scope.
- **Follows:** each must be an active dentist of the clinic (422 `alerts.dentist_invalid`), and
  following another dentist needs `visit:read_all` (403). Audited as `alerts.follows`.
- **The ping** carries nothing and goes to every open stream of the tenant after the commit. The
  browser refetches and decides what alerts (ADR-0073).
- **One API instance:** the hub is in memory.

## In the SPA

`features/alerts/`: the header's **Your patients** (`patients-tray.tsx`, which replaced the
live-visit pill). It holds the list, the sound and Windows notification switches (per device) and
Follow dentists. `use-alerts.ts` holds the stream, the alert diff and the announcement (a sticky
toast, the chime, a system notification while hidden). `alert-diff.ts` is the pure rule.
