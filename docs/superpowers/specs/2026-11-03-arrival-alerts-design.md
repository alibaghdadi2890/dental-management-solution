# Arrival alerts — design

Feature 15. Branch `feature/15-arrival-alerts`. Agreed with the owner on 2026-11-03.

## Problem

The front desk checks a patient in and, once the patient is in the room, starts the visit. The
dentist should hear about both without watching a screen, and reach the visit in one click. Today
the front desk cannot start a visit (`visit:write` is the workspace's permission too, feature 14
G10), and nothing tells the dentist anything: the Today board and the Schedule poll every 30 s,
and the live-visit pill only shows visits the dentist is already in.

## Decisions

- **D1. The front desk starts the visit (option A).** They start it when the patient enters the
  room, so the visit's clock counts the treatment, not the wait. The dentist does not click Start.
- **D2. A new permission `visit:start`**: start a visit, without working in it. `visit:write`
  implies it. The front desk and admin roles get it by default, as do their templates. It amends
  feature 14 G10.
- **D3. Who is alerted**: the visit's or appointment's dentist, always, plus whoever follows that
  dentist. Following another dentist needs `visit:read_all` (the visit scope, ADR-0055).
- **D4. What alerts**: a patient checked in (_arrived_), and a visit started by someone other than
  the person alerted (_in room_). Undo check-in, cancel, discard and complete only clear the item,
  silently.
- **D5. The tray is derived, never stored.** "Your patients" is read from what `scheduling` and
  `clinical` hold, so there is nothing to mark read and nothing to drift. Only the follows are
  stored.
- **D6. Push is a ping, broadcast per tenant.** An after-commit subscriber sends "the tray may have
  changed" over SSE to every connected user of the tenant. Each browser refetches its own tray and
  chimes for items new to it. The ping carries no data, so recipient rules live in one place, the
  tray read. It runs in process: one API instance only (ADR-0073), no Redis.
- **D7. Sound and Windows notifications are per device**, saved in `localStorage`. Follows are per
  person, saved on the server.
- **D8. Out of scope**: "seen by the dentist" for the front desk, quiet hours, hiding names,
  mobile push, a running timer on the appointment card.

## Permissions and roles (`roles`, `clinical`, contracts)

- `visit:start` in `permissions.ts`; capability group `visits`, between `visit:read_all` and
  `visit:write`; `CAPABILITY_IMPLIES['visit:write']` gains `visit:start`.
- Migration `0057` adds `visit:start`, `ON CONFLICT DO NOTHING`:
  - to every role that holds `visit:write` (system and custom), and to every user grant set
    that holds it, so nobody loses Start;
  - to the `frontdesk` and `admin` roles of every clinic, and to both templates.
- `POST /visits`, `GET /visits/start-defaults` and `GET /visits/start-options` require
  `visit:start` (route and service). Everything else in the visit stays on `visit:write`.
- `docs/modules/roles.md` matrix: a `visit:start` row (owner, admin, dentist, assistant,
  frontdesk ✓).

## The front desk's Start (web)

- `useAppointmentAbilities().startVisit` checks `visit:start`. The appointment popover's Start
  visit opens the side panel (already built) for checked-in appointments, as today.
- The patient record's Start visit (walk-ins) and the Today board's Start show for `visit:start`.
- After a start, someone without `visit:write` stays where they are, with the toast
  "Visit started · Dr. Reyes · Room 1". With `visit:write`, they go to the workspace as today.
- With only `visit:start`, the start defaults give no dentist (as for an assistant now); the
  appointment preset fills it.

## The `alerts` module (API)

New module `apps/api/src/modules/alerts/`. It owns `alert_follows`. It depends on `scheduling`,
`clinical`, `users` and `audit`. Nothing depends on it.

**Table `alert_follows`**: `id`, `tenant_id` (RLS), `user_id` (auth user id), `dentist_id`
(staff profile id), `created_at`, `updated_at`. Unique on `(user_id, dentist_id)`. Rows are
hard-deleted (junction).

**Routes**, all `@RequirePermission('visit:write')`:

- `GET /alerts/tray` → `AlertTray`:
  - `waiting[]` (today's checked-in appointments of the session's branch for the caller's
    dentists): `appointmentId`, `patientId`, `patientName`, `dentistId`, `dentistName`,
    `roomName | null`, `startsAt`, `checkedInAt`.
  - `inRoom[]` (live visits of those dentists, any branch, and those the caller started, so the
    tray also replaces the live-visit pill; within the caller's visit scope): `visitId`, `patientId`,
    `patientName`, `dentistId`, `dentistName`, `roomName | null`, `status`, `startedAt`,
    `pausedAt`, `pausedSeconds`, `startedBy`, `startedByName`.
  - `follows`: dentist profile ids.
  - `serverNow`.
- `PUT /alerts/follows` `{ dentistIds }`. Needs `visit:read_all` for any id other than the caller's
  own profile. Each id must be an active dentist of the clinic. Audited; `area` is null.
- `GET /alerts/stream`: SSE. It sends `event: tray` on a ping and a comment every 25 s.

**The caller's dentists** are their own staff profile when they are a practitioner, plus their
follows, minus deactivated dentists. With none, the tray is empty and says how to follow.

**The hub** (`alerts/application/alert-hub.ts`) holds connections by tenant id and drops them on
close. An after-commit `@OnDomainEvent` subscriber pings the tenant on each of these events:
`AppointmentCheckedIn`, `AppointmentCheckInUndone`, `AppointmentCancelled`, `VisitStarted`,
`VisitPaused`, `VisitResumed`, `VisitDiscarded`, `VisitCompleted`. The SSE route is the only code
that knows the transport. The browser coalesces pings that arrive within 300 ms.

**Reads it needs**, exported from the owning modules' `index.ts`:

- `scheduling`: today's appointments of a branch by status and dentists.
- `clinical`: the branch's live visits for dentists, with room and starter.
- `users`: names and the active flag.

**Ops**: `apps/web/nginx.conf` gets `location /api/v1/alerts/stream` with `proxy_buffering off`
and `proxy_read_timeout 1h`. Vite's dev proxy needs nothing.

## The tray (web, `features/alerts/`)

**The header button** replaces `LiveVisitPill` for people with `visit:write`:

- With nothing in the tray, it is a muted icon button, "Your patients".
- Otherwise it is a pill showing the count. It pulses while it holds items new since the list was
  last opened.

**The list** (a popover under the button) has two sections, and each row is one click:

- **In room**: "Sofia Mendes · Room 1 · 12:03 · started by Jamie". Opens the workspace.
- **Waiting**: "Omar Farouk · 10:00 · waiting 6 min". Opens the appointment on the Schedule
  (`?appointment=`).
- New rows are highlighted until the list is opened.

**Its footer** holds the settings:

- the sound switch: On, Off, or "Click to turn on sound" while the browser blocks it;
- Windows notifications: Turn on (asks the browser), On, or Blocked by the browser;
- Follow dentists: a checklist of the branch's dentists. It is shown only with `visit:read_all`
  or without a profile of one's own.

**Updates**:

- `EventSource` on `/api/v1/alerts/stream`. Each `tray` event refetches the tray, and the
  schedule and visit lists on screen (the Today board's lanes).
- A platform admin acting in a clinic gets no tray: `EventSource` cannot send `X-Tenant-Id`.
- The tray also polls every 60 s and refetches on focus.
- `EventSource` reconnects by itself; on open it refetches.

**Alerts**: an item is `arrived:<appointmentId>` or `started:<visitId>`.

- When an item appears that this browser has not seen, it alerts. Visits the caller started do
  not alert.
- The first load in a browser only records what is there and does not alert. So does the first
  comparison after the follows change: following someone doesn't alert for everyone they have.
- Seen keys are kept per user in `localStorage`, pruned to what the tray holds. A patient who
  arrived while the app was closed alerts once when it is opened.
- **One tab alerts**: the tab holding the Web Lock `dcm-alerts` plays the chime and shows
  notifications. The tab last focused takes it (`steal`), since its sound is unlocked and its
  toasts are seen. When it closes, a waiting tab takes the lock.
- **The stream reconnects**: `EventSource` retries a dropped connection itself, but gives up on an
  error answer, such as a 502 while the API restarts. Then it is reopened, backing off from 2 s to
  a minute.

**An alert** is:

- a sticky toast with an action: "Sofia Mendes arrived · Dr. Reyes", action "Open". It is a new
  `sticky` option on the toast; it stays until clicked or closed;
- a chime: Web Audio, synthesised, one tone for arrived and two for in room;
- when `document.hidden` and permission is granted, a Windows notification (`silent: true`,
  `tag` = item key). Clicking it focuses the window and opens the target.

**Sound unlock**: one `AudioContext`, resumed on the first `pointerdown` or `keydown` on the page.
The switch shows "Click to turn on sound" while its state is `suspended`.

## Testing

- **Contracts**: the capability closure gives `visit:write ⇒ visit:start`.
- **API integration**:
  - Front desk starts a visit with `visit:start` and gets 403 on a workspace write.
  - The tray: waiting and in room for the dentist, a follower, and a non-follower, and the
    branch scope.
  - `PUT /alerts/follows` rules.
  - Tenant isolation for `alert_follows` and the tray.
  - The migration's grants (a custom role with `visit:write` gets `visit:start`).
- **API unit**: the hub (by tenant, closed connections dropped); the subscriber pings on each event.
- **Web**:
  - the tray's alert logic (`alert-diff.ts`, pure): first load, new, own start, pruning;
  - the tray component (sections, settings visibility);
  - the start panel without `visit:write` stays and toasts.
- **Playwright**: the front desk checks in and starts, and a dentist in a second context sees the
  waiting row, then the in-room row, and opens the visit.

## Docs

- `docs/modules/alerts.md`.
- ADR-0073: alerts are a per-tenant ping over in-process SSE, and the tray is derived.
- ADR-0074: `visit:start`.
- CLAUDE.md module map: `alerts`, and `clinical`'s Start permission.
- Feature 14 spec G10: a pointer to this spec.
