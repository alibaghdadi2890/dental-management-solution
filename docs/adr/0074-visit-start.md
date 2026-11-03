# ADR-0074: `visit:start`, starting a visit without working in it

- Status: Accepted
- Date: 2026-11-03
- Amends: feature 14 spec G10 ("Start visit follows `visit:write`")

## Context

The owner wants the dentist to touch the app as little as possible. The front desk brings the
patient in and should start the visit, and only once the patient is in the room, so the visit's clock
still counts the treatment. Until now `visit:write` was both "start a visit" and "work in it", and
the front desk had neither.

## Decision

1. A new permission, `visit:start`, covers `POST /visits`, `GET /visits/start-defaults` and
   `GET /visits/start-options`, in the routes and in the services. Everything inside a visit stays on
   `visit:write`. `visit:write` implies `visit:start` (`CAPABILITY_IMPLIES`).
2. The front desk and the admin hold it by default. Migration `0057` adds it, only adding, to every
   role, template and personal grant that holds `visit:write` (custom roles included), and to the
   `owner`, `admin` and `frontdesk` roles and templates.
3. In the SPA, Start visit shows for `visit:start` (the appointment popover, the Today board, the
   record header, the new-patient toast). Resume needs `visit:write`. A start without `visit:write`
   stays where it was, with a toast naming the dentist and the room.
4. The visit is the dentist's from the start (`dentist_id`). `started_by` is the front desk user, so
   the starter's visit scope (`visit:read`) covers it.

## Consequences

- The dentist learns of it through the arrival alerts (ADR-0073), where the visit opens in one click.
- A clinic that wants the old behaviour unticks Start visits on its front desk role.
