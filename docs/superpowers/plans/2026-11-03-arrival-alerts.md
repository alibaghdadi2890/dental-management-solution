# Arrival alerts — implementation plan

Spec: `docs/superpowers/specs/2026-11-03-arrival-alerts-design.md` (D1–D8).

Ground rules:

- Branch `feature/15-arrival-alerts`. Nothing is committed until the owner asks.
- Per task, run the affected tests and that package's typecheck. Task 9 runs everything, then one
  review over the branch.
- Paths are under `apps/api/src/modules/` (API) or `apps/web/src/features/` (web) unless they
  start with `apps/`, `packages/` or `docs/`.
- New strings go to `apps/web/src/locales/{en,ar,fr}/` in the task that adds them.
- The app is live: migration 0057 only adds. Existing API shapes only gain fields.
- No queue, job or new Redis use.

## 1. `visit:start` (contracts, roles, clinical)

- `packages/contracts`: the permission, its capability group, `visit:write ⇒ visit:start`, and
  the role labels in the three locales.
- `clinical/http/visits.controller.ts` and the start, start-defaults and start-options services
  move to `visit:start`.
- Migration `0057_arrival_alerts.sql`, part 1: the grants per the spec. Check the role and grant
  tables against `0054_admin_role.sql`.
- `docs/modules/roles.md`: the matrix row.
- Done: an integration test where the front desk starts a visit and gets 403 on a step change;
  and a custom role with `visit:write` holds `visit:start` after the migration.

## 2. The front desk's Start (web)

- `scheduling/use-appointment-actions.ts`: `startVisit` checks `visit:start`.
- The Start visit buttons on the record header, the history tab, the tooth history and the Today
  board show for `visit:start`.
- `clinical/start-visit-popover.tsx`: without `visit:write`, a start toasts
  "Visit started · {dentist} · {room}" and does not navigate (popover and panel).
- Done: a spec for the panel without `visit:write` (toast, no navigation).

## 3. `alerts` persistence and follows (API)

- Module skeleton: `alerts.module.ts`, `index.ts`, `persistence/schema.ts` (`alert_follows`),
  migration 0057, part 2 (table, RLS, index, grants to `dcm_app`).
- `AlertFollowsService.set({ dentistIds })` with the rules, and audit.
- Contracts `packages/contracts/src/alerts.ts`: `alertTraySchema`, `alertFollowsInputSchema`.
- Done: integration tests for the follow rules and tenant isolation.

## 4. The tray read (API)

- New reads exported from `scheduling` (checked-in today by branch and dentists) and `clinical`
  (live visits by branch and dentists, with room and starter), with names from `users`.
- `AlertTrayService.forCaller()` and `GET /alerts/tray`, `PUT /alerts/follows`.
- Done: one integration spec covering the dentist, a follower, a non-follower, branch scope, and
  a deactivated dentist.

## 5. The hub and the stream (API, ops)

- `alert-hub.ts`: a map from tenant to subscribers; `ping(tenantId)`.
- The after-commit subscriber on the spec's events.
- `GET /alerts/stream` (`@Sse`): subscribes on the CLS tenant, sends a 25 s heartbeat, and
  unsubscribes on close.
- `apps/web/nginx.conf`: the stream location.
- Done: unit tests for the hub and the subscriber; a manual curl check that a check-in reaches an
  open stream.

## 6. Alert logic and devices (web)

- `alerts/alert-diff.ts` (pure, with a spec): item keys, first-load baseline, new items, own
  starts skipped, pruning.
- `alerts/use-alert-stream.ts`: `EventSource`, coalescing, refetch.
- `alerts/chime.ts`: the `AudioContext`, unlock on gesture, two sounds.
- `alerts/leader.ts`: the Web Lock.
- `alerts/desktop-notify.ts`: permission and show.
- `components/ui/toast`: a `sticky` option.

## 7. The tray UI (web)

- `alerts/patients-tray.tsx`: the header button, the popover list, and the footer settings
  (sound, Windows notifications, follows). It replaces `LiveVisitPill` in `shell/app-header.tsx`;
  delete `live-visit-pill.tsx` if nothing else uses it.
- Strings in en, ar and fr.
- Done: a spec for the sections, row targets and settings visibility. Check it in the browser:
  two signed-in users, check in, start, chime, toast, open.

## 8. Docs

- `docs/modules/alerts.md`, ADR-0073, ADR-0074, CLAUDE.md module map and the clinical row, and the
  feature 14 spec G10 pointer.

## 9. Finish

- Playwright `apps/web/e2e/arrival-alerts.spec.ts`: the front desk and the dentist in two
  contexts, using the e2e clinic set-up from `appointments.spec.ts` (the mid-morning zone).
- Full format, lint, typecheck, test, build and e2e. One review over the branch, fix its
  findings, and report.
