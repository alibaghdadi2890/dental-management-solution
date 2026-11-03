# ADR-0073: Arrival alerts are a per-tenant ping over in-process SSE

- Status: Accepted
- Date: 2026-11-03

## Context

The front desk checks a patient in and, once the patient is in the room, starts the visit
(ADR-0074). The dentist, often with other software in front, must hear about both and reach the
visit in one click. Polling every 30 s was the only way the SPA learned of changes. Browsers slow
the timers of hidden tabs to about once a minute, so polling alone can't alert promptly. We use no
new Redis, and run one API instance behind nginx and Cloudflare.

## Decision

1. **The tray is derived, never stored.** `GET /alerts/tray` is read from `scheduling` (today's
   checked-in appointments of the session's branch) and `clinical` (live visits) for the caller's
   dentists. Those are their own staff profile, plus whom they follow (`alert_follows`, the only
   table). There is no notification row, nothing to mark read, and nothing to drift between
   computers.
2. **The push is a ping that carries no data.** An after-commit subscriber of the `alerts` module
   pings every open stream of the tenant on the events that add a patient to a tray or take one
   off. Each browser refetches its own tray. Who is alerted is decided in one place, the tray read.
3. **Server-sent events, held in process.** `GET /alerts/stream` (`@Sse`) sends `tray` on a ping
   and `ping` every 25 s, under Cloudflare's 100 s idle cut. nginx serves that one location
   unbuffered with a 1 h read timeout. The hub is a map in memory, so this works for **one API
   instance only**. A second instance would carry the ping between instances with Postgres
   `LISTEN/NOTIFY`, not Redis.
4. **The browser decides what alerts.** A tray item that this browser has not seen alerts once:
   `arrived:<appointmentId>`, `started:<visitId>`, a start by the caller excepted. Seen keys are
   kept per user in `localStorage`. The first load only records. One tab alerts, the holder of a
   Web Lock. The tray also polls every 60 s and refetches on focus and on reconnect.
5. **Sound and Windows notifications are per device.** The chime is synthesised with Web Audio and
   unlocked by the first gesture on the page, since browsers block audio before one. System
   notifications are opt-in, shown only while the page is hidden, and silent.

## Consequences

- A platform admin acting in a clinic gets no tray, since `EventSource` cannot send
  `X-Tenant-Id`. So they also lose the live-visit pill the tray replaced, and get back to a visit
  from the Visits list.
- A missed ping costs at most a minute. A tab asleep or closed misses the chime, never the tray.
- The ping also refreshes the calendar, the Today board and the live visit lists that are on screen.
- Scaling the API out needs the `NOTIFY` bridge first.
