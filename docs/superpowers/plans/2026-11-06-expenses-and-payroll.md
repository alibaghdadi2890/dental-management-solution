# Clinic expenses and payroll — implementation plan

Spec: `docs/superpowers/specs/2026-11-06-expenses-and-payroll-design.md` (P1–P9, D1–D8).

Ground rules:

- Nothing is committed until the owner asks.
- Per task, run the affected tests and that package's typecheck. Task 14 runs everything, then
  one review over the working tree.
- Paths are under `apps/api/src/modules/` (API) or `apps/web/src/features/` (web) unless they
  start with `apps/`, `packages/` or `docs/`.
- New strings go to `apps/web/src/locales/{en,ar,fr}/` in the task that adds them.
- The app is live. Migration 0058 only adds, and existing API shapes only gain fields.
- No queue, job or new Redis use.

## 1. Contracts and permissions

- `packages/contracts`:
  - `permissions.ts`: the four permissions.
  - `capabilities.ts`: the `expenses` and `payroll` groups, and `manage ⇒ read`.
  - New `expenses.ts`: category keys, the schemas of every route body, query and response,
    and `EXPENSE_SOURCES`.
  - New `payroll.ts`: the schemas, `PAYROLL_EVENTS`, and `adjustmentEffect` / `netPay`, with a
    spec.
  - `audit.ts`: the two areas and the prefixes.
  - `monthSchema` moves to `common.ts`, re-exported from `compensation.ts`.
- `platform/cls/request-context.ts`: a platform admin holds no `payroll:*`.
- `apps/api/src/platform/kernel/months.ts`: compensation's `domain/months.ts` moves here, and
  compensation imports it.
- `roles` locales: the labels and descriptions of the four permissions, in three languages.
- Done: the contracts specs pass (capabilities, audit, netPay), and the request-context spec
  covers payroll for a platform admin.

## 2. Schema and migration 0058

- `expenses/persistence/schema.ts` and `payroll/persistence/schema.ts`, per the spec.
- `drizzle-kit generate` → `0058_expenses_payroll.sql`. Then append by hand:
  - RLS policies and grants (REVOKE as specified);
  - the category seed for every tenant;
  - the payout back-fill;
  - the owner and admin permissions and templates.
- Apply it to the dev DB.
- Done: the migration runs on a copy of the dev DB, the back-fill row count equals the payout
  count, and the RLS list in `tenant-isolation-services.int-spec.ts` gains the 9 tables.

## 3. `expenses` domain

- `domain/catch-up.ts`: the months to generate for a template, given its status, `next_month`
  and the current month; and resume.
- `domain/categories.ts`: what each kind may do; name uniqueness against custom names and
  translations.
- `domain/expense-errors.ts`.
- Done: unit specs.

## 4. `expenses` categories, record, edit, void

- The module skeleton, `index.ts`, repositories, and `ExpensesService`:
  - categories: list, create, patch, delete, and seed-if-missing;
  - expenses: record (idempotent), patch, void, list with totals and `byCategory`, year, export,
    with visibility by source.
- `application/export-labels.ts`: the CSV headers and category names in en, ar and fr.
- The `TenantProvisioned` seeding subscriber, and the currency-lock subscriber.
- `http/expenses.controller.ts`. Register the module in `app.module.ts`.
- Done: the first half of `expenses.int-spec.ts` (categories acceptance, the Rent 450 → 460 →
  void acceptance, the currency lock, idempotency).

## 5. `expenses` fixed expenses and pending items

- `FixedExpensesService`:
  - the catch-up under an advisory lock;
  - templates: create, patch, pause, resume, end, list, and one template with its items;
  - pending: list, confirm (batch, idempotent), skip, unskip;
  - the dashboard read.
- Voiding a `fixed` expense reopens its item.
- Done: the Electricity Sep–Nov acceptance with the test clock, a batch confirm, the dashboard
  excluding payroll and compensation, and the zone around midnight on the 1st.

## 6. Mirrors in `expenses`

- `compensation/events`: the `PayoutRecorded` and `PayoutVoided` payloads gain `amount`,
  `currency`, `method` and `reference`.
- `expenses/application/mirror.subscriber.ts`: in-transaction handlers for the payout events and
  the payroll payment events. Reserved categories are ensured inside the transaction. The payee
  name comes from `users`.
- Done: tested in Task 8's spec (payroll) and an expenses case for a payout recorded and voided.
  Visibility is checked per permission.

## 7. `payroll` domain

- `domain/employment.ts`: employed months, and the joined/left notes.
- `domain/salaries.ts`: the salary in force, and the back-date rule.
- `domain/lines.ts`: a line's status, base and net.
- `domain/payroll-errors.ts`.
- Done: unit specs.

## 8. `payroll` services and routes

- Repositories, and `PayrollService`:
  - employees: CRUD, link and unlink, leave and rejoin, remove, and the staff picker through a
    new ungated `UsersService.staffSummaries()`;
  - salaries;
  - runs: read, adjust, confirm (batch, idempotent, stale-net check), skip, unskip, void;
  - months, and both exports.
- Events `PayrollPaymentConfirmed` and `PayrollPaymentVoided`. The currency-lock subscriber.
- `http/payroll.controller.ts`. Register the module.
- Done: `payroll.int-spec.ts` per the spec, including Rima's acceptance, the left employee, the
  platform admin denied, and a custom role with only `expense:read`.

## 9. Audit filters

- `audit.repository.ts`: `withoutExpenses` and `withoutPayroll`.
- `audit.service.ts`: wire both, and platform Activity always without payroll.
- Done: an audit case in `payroll.int-spec.ts` (`expense:read` only: no payroll rows, salary
  events or expense-mirror leaks).

## 10. Web: shell, Today card, Expenses

- `shell/nav-items.ts` and its spec, and the nav icons. The Today guard and nav accept
  `expense:read`.
- `features/expenses/`:
  - `expenses-api.ts`;
  - `today-expenses-card.tsx`;
  - `expenses-page.tsx` with the History, Year, Fixed and Categories tabs;
  - `expense-panel.tsx`, `confirm-items-dialog.tsx`, `fixed-expense-panel.tsx`,
    `categories-tab.tsx`, `void-dialog.tsx`;
  - the route `routes/_app/expenses.tsx`, with search params.
- Locales: `expenses.json` (en, ar, fr), plus the shell and today keys.
- Done: specs for the confirm dialog (per-row amounts, total), the card's gating and the nav.

## 11. Web: Payroll

- `features/payroll/`:
  - `payroll-api.ts`;
  - `payroll-page.tsx` with the Run, Employees and Year tabs;
  - `run-tab.tsx`, `adjustments-dialog.tsx`, `confirm-lines-dialog.tsx`;
  - `employee-panel.tsx`, `employee-form.tsx`, `salary-dialog.tsx`;
  - the route `routes/_app/payroll.tsx`.
- Locales: `payroll.json`.
- Done: specs for the adjustments dialog (live net, negative refused) and the bulk confirm
  dialog.

## 12. Web: Activity

- `audit/sentence.ts`: sentences for the new actions; the area filter shows the new areas only
  with the permission; activity locales.
- Done: `sentence.spec.ts` cases.

## 13. Docs

- ADR-0076 to ADR-0080.
- `docs/modules/expenses.md` and `docs/modules/payroll.md`.
- `docs/modules/roles.md`: the matrix rows.
- `docs/modules/audit.md`: the filter note.
- `docs/modules/compensation.md`: the event payloads and the mirror.
- `CLAUDE.md`: the module map, and §6 on the platform admin and payroll.

## 14. e2e, full checks, review

- `apps/web/e2e/expenses-payroll.spec.ts`: both acceptance flows.
- Full lint, typecheck, unit, integration and Playwright (`--workers=3`).
- One review of the whole diff, then fix its findings.
