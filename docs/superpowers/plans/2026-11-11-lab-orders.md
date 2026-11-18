# Lab orders and lab accounts — implementation plan

Spec: `docs/superpowers/specs/2026-11-11-lab-orders-design.md` (O1–O11, D1–D9).

Ground rules:

- Branch `feature/18-lab-orders`. Nothing is committed until the owner asks.
- Per task, run the affected tests and that package's typecheck. Task 14 runs everything, then
  one review over the working tree.
- Paths are under `apps/api/src/modules/` (API) or `apps/web/src/features/` (web) unless they
  start with `apps/`, `packages/` or `docs/`.
- New strings go to `apps/web/src/locales/{en,ar,fr}/` in the task that adds them.
- The app is live: migration 0059 only adds; existing API shapes only gain fields.
- No queue, job or new Redis use.

## 1. Contracts and permissions

- `packages/contracts`:
  - `permissions.ts`: the four permissions; `capabilities.ts`: the `lab` group and implications.
  - New `labs.ts`: statuses, enums, every route schema, `LAB_MONEY_EVENTS`, `labOrderLabel`
    (label, tone, urgency) with a spec, `formatLabOrderNumber`.
  - `audit.ts`: the `labs` area and its prefixes; `expenses.ts`: the `lab` source.
- `roles/domain/system-roles.ts`: dentist, assistant, front desk get `lab:read` and `lab:manage`.
- `roles` locales: labels and descriptions in three languages.
- Done: contracts specs pass (capabilities, audit, label).

## 2. Schema and migration 0059

- `labs/persistence/schema.ts`; `expenses/persistence/schema.ts` with the `lab` source.
- `drizzle-kit generate` → `0059_lab_orders.sql`, then by hand: RLS policies, REVOKEs, the
  permissions for the system roles and templates.
- Apply it to the dev DB.
- Done: the migration runs; the RLS list in `tenant-isolation-services.int-spec.ts` gains the
  tables.

## 3. `labs` domain

- `domain/order-status.ts`: the transitions, undo steps, hold/resume, cancel rules.
- `domain/dates.ts`: expected date, late, the next open day, date-shift on correction.
- `domain/account.ts`: owed, outstanding, in progress, statement lines and running balance.
- `domain/today-lane.ts`: the reason of an order and the lane order.
- `domain/reports.ts`: the figures from trips and orders.
- `domain/lab-errors.ts`.
- Done: unit specs.

## 4. Scheduling, patients, files, clinical reads

- `scheduling/index.ts` exports the booked, rescheduled, cancelled, no-show and completed events,
  and `AppointmentsService` gains ungated `refsByIds`, `upcomingForPatient`, `openWeekdays`.
- Whatever `labs` needs from `files` (a file's patient), `clinical` (a live visit's patient and
  dentist, open plan items) and `users`, as ungated internal reads where missing.
- Done: typecheck; existing scheduling tests green.

## 5. `labs` labs, services, money

- Module skeleton, `index.ts`, repositories, `LabsService` (directory, services, opening balance,
  payments, voids, adjustments, accounts, statement + export) and the currency lock.
- Events `LabPaymentRecorded`, `LabPaymentVoided`. Register the module.
- Done: the labs/money part of `labs.int-spec.ts`.

## 6. `labs` orders

- `LabOrdersService`: create (idempotent), edit, send, receive (batch), expected, outcome,
  hold/resume, cancel, undo, link, attachments, trip dates; reads (list, open, one, proposal,
  export); the patients route.
- `labs.subscriber.ts`: the appointment events (D4), merge and archive.
- Done: the orders part of `labs.int-spec.ts`, including the appointment link acceptance.

## 7. Today lane and reports

- `LabOrdersService.today(branchId)`; `LabReportsService`.
- Done: the Today and reports acceptance in `labs.int-spec.ts`.

## 8. Expenses mirror and audit filter

- `expenses`: `LabPaymentMirrorSubscriber`, the `lab` source in visibility, the dashboard, the
  export labels.
- `audit`: `withoutLabMoney`.
- Done: the money acceptance (payment → expense → void) and an audit case.

## 9. Web: API client, labels, Lab screen

- `features/labs/`: `labs-api.ts`, `lab-order-label.tsx`, `lab-order-mark.tsx`, the Lab page
  (Orders, Labs, Reports), `lab-order-panel.tsx`, `new-lab-order-panel.tsx`, `lab-panel.tsx`
  (details, price list, account), `lab-slip-document.tsx`; route `routes/_app/lab.tsx`; nav.
- Done: specs for the order form and the label.

## 10. Web: Today, calendar, patients

- Today's Lab work lane with Undo; the calendar card mark and popover; today's schedule rows;
  the patients list label and chip; the record's Lab work card and Needs attention items.
- Done: Today lane spec.

## 11. Web: visit and booking

- The start-visit popover, the workspace card and _New lab order_, the Complete step choices
  and the next-appointment hint; the booking warnings.
- Done: Complete step spec.

## 12. Web: Expenses and Activity

- The `lab` source label and the _Lab fees_ hint; Activity sentences and the area.
- Done: sentence spec cases.

## 13. Docs

- ADR-0081 to ADR-0086; `docs/modules/labs.md`; `expenses.md`, `scheduling.md`, `audit.md`,
  `roles.md`, `patients.md`; the `CLAUDE.md` module map.

## 14. e2e, full checks, review

- `apps/web/e2e/lab-orders.spec.ts`: the end-to-end flow.
- Format, lint, typecheck, unit, integration and Playwright (`--workers=3`); one review.
