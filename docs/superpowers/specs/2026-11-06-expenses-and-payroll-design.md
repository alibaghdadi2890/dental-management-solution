# Clinic expenses and payroll — design

Feature 17. Written 2026-11-06 from the feature prompt (business requirements). The decisions the
prompt says were taken with the owner (P1–P9 below) are not reopened. Everything marked **(my
call)** was agreed with the owner on 2026-11-06.

## Problem

The clinic records what patients pay, but not what it spends. The owner wants two things. The
first is a history of what the clinic paid: rent, supplies, salaries and the dentists' payouts,
so total spending is complete. The second is a payroll for everyone who is not a dentist. Nothing
may be counted twice or happen by itself, and every total can be opened down to its rows.

## Decisions from the prompt (not reopened)

- **P1.** Dentists are not on payroll. They are paid through compensation. A dentist staff user
  can't be linked to an employee.
- **P2.** Dentist payouts appear in Expenses automatically, as read-only _Dentist compensation_
  rows. Payouts that already exist are included.
- **P3.** An expense is always a payment that already happened. There are no bills or due dates.
- **P4.** A salary is never typed as an expense. It comes only from a confirmed payroll line.
- **P5.** Fixed expenses are confirmed one by one, and the amount can be changed at
  confirmation.
- **P6.** A branch is optional everywhere (empty means clinic-wide).
- **P7.** An edit is audited. A void keeps the row with its reason. There is no month closing.
- **P8.** Expenses and payroll have separate permissions.
- **P9.** The dashboard card never shows salaries or dentist compensation.

## Design decisions

- **D1. Two modules, `expenses` and `payroll` (ADR-0076).**
  - `payroll` never imports `expenses`. Confirming a line publishes `PayrollPaymentConfirmed`,
    and voiding it publishes `PayrollPaymentVoided`. `expenses` reacts to both **in the
    transaction** (`@OnDomainEventInTransaction`), creating or voiding the _Salaries_ row.
  - The same applies to `compensation`'s `PayoutRecorded` and `PayoutVoided`. Their payload
    gains the minimal facts the mirror needs: `amount`, `currency`, `method`, `reference`.
  - Mirrored rows have `source = payroll | compensation` and `source_id` = the payment or payout
    id (unique). Expenses refuses to edit or void them (409 `expense.system_row`).
  - Migration 0058 back-fills one row for every existing payout, voided payouts as voided.
  - There is no queue (no Redis) and no second write path.
- **D2. Dentists are excluded from payroll (ADR-0077).** The link is refused when the staff
  user's practitioner type is `dentist` (422 `payroll.dentist_not_linkable`). If a linked user
  later becomes a dentist or is deactivated, nothing changes by itself. The employee screen shows
  a notice and the owner decides.
- **D3. Pending items are generated when the clinic next looks; payroll lines are derived (ADR-0078).**
  - There is no job and no timer. Every expenses read or write that shows pending items first
    runs a **catch-up**. For each _active_ fixed expense, it inserts one item per month from the
    template's `next_month` through the current month (clinic time zone), then advances
    `next_month`.
  - The catch-up is idempotent: it runs under an advisory lock per tenant, with a unique key on
    `(fixed_expense_id, month)`. From the clinic's side, "on the 1st of the month" and "the first
    time anyone looks that month" are the same.
  - An item **snapshots** the template (amount, category, method, payee, branch, name). That is
    how "a template edit never changes a month already pending" holds.
  - **Payroll lines are not materialised.** A line for (employee, month) exists for every month
    the employee is employed, up to the current month. A row is stored only once someone adjusts,
    skips or pays it. A pending line's base salary is therefore always the salary in force: a
    back-dated salary or an end date set later moves the pending lines with it, and nothing goes
    stale.
- **D4. A salary is a dated history (ADR-0079).**
  - Entries are append-only (`employee_salaries`; the runtime role has no UPDATE or DELETE).
  - The salary for month M is the latest entry with `effective_month ≤ M`, the newest created
    winning a tie.
  - **(my call)** A new entry must take effect **after the employee's last paid month**
    (409 `payroll.month_paid`). Back-dating into unpaid months is allowed. A paid month keeps
    what was paid, because the payment stores its base, adjustments and net.
  - A wrong entry is corrected by adding another entry for the same month.
- **D5. Permissions (ADR-0080).**
  - The four new permissions are `expense:read`, `expense:manage`, `payroll:read` and
    `payroll:manage`, where `manage ⇒ read`. They form two new capability groups, `expenses` and
    `payroll`.
  - By default only the owner and admin hold them. Migration 0058 only adds them to every
    clinic's owner and admin roles and to those two templates.
  - A platform admin in a clinic holds `expense:*` but never `payroll:*`
    (`RequestContext.hasPermission`, next to `compensation:*`).
  - Mirrored rows are filtered by permission: _Payroll_ rows need `payroll:read`, and
    _Compensation_ rows need `compensation:manage`. Without the permission they are left out of
    lists, totals and exports. There is no hint that anything is hidden.
- **D6. The dashboard is the Today board (asked, as the prompt said; agreed).**
  - There is no screen called a dashboard. Today (`/today`) is the clinic's home board, so the
    card goes there.
  - Today's nav entry and its "no access" guard also open for `expense:read`. A custom role with
    only _See expenses_ gets a Today board with just the card. Landing paths don't change, except that someone who sees expenses but not patients lands on Today.
- **D7. Predefined categories (my call):**
  - They are translated by key in the SPA and in exports. They can be **deactivated and
    reactivated, but not renamed or deleted**: a rename would freeze one language.
  - _Other_ and the two reserved categories can't be renamed, deactivated or deleted.
  - Custom categories can be renamed, deactivated and reactivated. They can be deleted only if
    nothing ever used them (an expense, a fixed expense or an item).
- **D8. Employees are removed softly.** A _Remove_ is allowed only with no stored payroll line or
  payment. It sets `deleted_at` (the row stays, audited). Otherwise the employee is marked _Left_.
  There is no separate "archive" **(my call)**: _Left_ plays that part.

## Data (migration 0058, additive)

All tables are tenant tables (`tenantColumns`, RLS, `tenant_id` index), with `created_at` and
`updated_at`. Money is `numeric(12,2)` plus `currency`. Months are `YYYY-MM` text, checked by
regex.

**`expenses` module**

| Table                 | Columns (beyond the standard)                                                                                                                                                                                                                                             | Notes                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `expense_categories`  | `key` text null (`rent`, …, `other`, `salaries`, `dentist_compensation`), `name` text null (custom only), `active` bool, `created_by`                                                                                                                                     | unique `(tenant, key)`; unique `(tenant, lower(name))`; check exactly one of key/name                                             |
| `expenses`            | `spent_on` date, `category_id`, `amount` > 0, `currency`, `method`, `payee`, `reference`, `description`, `branch_id`, `source` (`manual`/`fixed`/`payroll`/`compensation`), `source_id`, `source_month`, `created_by`, `updated_by`, void columns, idempotency key + hash | unique `(source, source_id)` for payroll/compensation; unique live `(source_id)` for fixed; index `(tenant, spent_on)`; no DELETE |
| `fixed_expenses`      | `name`, `category_id`, `amount` > 0, `currency`, `method` null, `payee`, `branch_id`, `note`, `first_month`, `next_month`, `status` (`active`/`paused`/`ended`), `created_by`                                                                                             | no DELETE                                                                                                                         |
| `fixed_expense_items` | `fixed_expense_id`, `month`, snapshot (`name`, `category_id`, `amount`, `currency`, `method`, `payee`, `branch_id`), `status` (`pending`/`confirmed`/`skipped`), `expense_id`, `skip_reason`, `skipped_at`, `skipped_by`                                                  | unique `(fixed_expense_id, month)`; no DELETE                                                                                     |

**`payroll` module**

| Table                 | Columns                                                                                                                                                                                    | Notes                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `employees`           | `full_name`, `job_title`, `phone`, `email`, `hire_date`, `payroll_from` month, `branch_id`, `status` (`active`/`left`), `end_date`, `note`, `staff_profile_id`, `created_by`, `deleted_at` | unique live `staff_profile_id`; check `end_date` set iff `left`; no DELETE           |
| `employee_salaries`   | `employee_id`, `amount` > 0, `currency`, `effective_month`, `reason`, `created_by`                                                                                                         | append-only: no UPDATE or DELETE                                                     |
| `payroll_lines`       | `employee_id`, `month`, `status` (`pending`/`paid`/`skipped`), `skip_reason`, `skipped_at`, `skipped_by`                                                                                   | unique `(employee_id, month)`; no DELETE                                             |
| `payroll_adjustments` | `line_id`, `kind` (`bonus`/`deduction`/`other`), `label`, `amount` (as entered), `created_by`                                                                                              | replaced as a list while the line is pending (hard delete: it is the line's content) |
| `payroll_payments`    | `line_id`, `employee_id`, `month`, `base`, `adjustments` jsonb (snapshot), `net` > 0, `currency`, `paid_on`, `method`, `note`, `created_by`, void columns, idempotency key + hash          | unique live `line_id`; UPDATE only on the void columns                               |

The migration also:

1. Seeds every tenant's categories: the 14 predefined ones, `other`, `salaries` and
   `dentist_compensation`.
2. Back-fills `expenses` from `compensation_payouts`. The category is `dentist_compensation`, the
   payee is the dentist's display name, voided payouts are voided with their reason, and
   `created_by` and `created_at` are the payout's.
3. Adds the four permissions to every clinic's `owner` and `admin` roles and to their two
   templates, `ON CONFLICT DO NOTHING`.

A migration's SQL may read across modules once (it runs as the owner role). The runtime code
never does.

## Rules

### Categories

- The predefined keys are `rent`, `electricity`, `water`, `internet_phone`, `supplies`,
  `lab_fees`, `equipment`, `cleaning`, `marketing`, `software`, `taxes_fees`, `insurance`,
  `professional_fees` and `transport`, plus `other`, `salaries` and `dentist_compensation`.
- The names exist in en, ar and fr: in `apps/web/src/locales/*/expenses.json` and in the API's
  export labels.
- A custom name is 1 to 60 characters, trimmed. It must not equal, case-insensitively, another
  custom name or any translation of a keyed category (422 `expense.category_name_taken`).
- New clinics get the list through a `TenantProvisioned` subscriber, after the commit, as a
  system task. A failure is logged. Every expenses read also seeds the list when it is missing
  (insert if absent), so a failed seeding repairs itself.
- An inactive category is not offered for new expenses, fixed expenses or confirmations (422
  `expense.category_inactive`), but stays on old rows. A reserved category is never offered (422
  `expense.category_reserved`).

### Expenses

- Recording an expense (`expense:manage`, `Idempotency-Key`) takes these fields:
  - `spentOn`: at most today in the clinic's time zone.
  - `categoryId`.
  - `amount` > 0.
  - `method`: one of the payment methods.
  - `payee`, `reference`, `description` (required for _Other_) and `branchId` (an active
    branch), all optional.
- The currency is the clinic's.
- An edit changes any of those fields on a `manual` or `fixed` row that is not voided. Audit
  stores the changed fields, before and after.
- A void needs a reason. Voiding a `fixed` row puts its item back to `pending` and clears the
  item's expense link, in the same transaction.
- Totals never count voided rows.
- Visibility: `manual` and `fixed` rows need `expense:read`, `payroll` rows also need
  `payroll:read`, and `compensation` rows also need `compensation:manage`.

### Fixed expenses

- A fixed expense has these fields:
  - `name`: required, and copied to the expense as its description.
  - `categoryId`: active and not reserved. _Other_ is allowed, because the name describes it.
  - `amount` > 0.
  - `method`, `payee`, `branchId` and `note`, all optional.
  - `firstMonth`: defaults to the current month, may be earlier, and may be in the future.
- Creating it runs the catch-up, so a past first month immediately gives one pending item per
  month up to now.
- **Pause** stops generation. **Resume** sets `next_month = max(next_month, current month)`, so
  the paused months are skipped. **End** is final.
- Items already generated stay pending whatever the template's status. Pause, resume and end
  each run the catch-up first.
- An edit (name, category, amount, method, payee, branch, note) applies to months generated
  after it. `firstMonth` is fixed once created.
- **Confirm** works on 1 to 50 pending items. Each carries `itemId`, `spentOn` (at most today),
  `amount` > 0, `method`, `categoryId`, `payee`, `reference`, `branchId` and `description`,
  pre-filled from the item. Each creates a `fixed` expense with `source_id = item id` and
  `source_month = item month`, and marks the item `confirmed`.
- An item that is not pending refuses the whole batch (409 `expense.item_not_pending`). Retries
  with the same key return the same expenses.
- **Skip** (with an optional reason) closes a pending item. **Undo skip** puts a skipped item
  back to pending.
- Pending items are listed oldest month first, then by name.

### Payroll

- An employee is **employed in month M** when
  `max(month(hire_date), payroll_from) ≤ M ≤ month(end_date)`, where an active employee has no
  upper bound, and M is at most the current month.
- `payroll_from` defaults to the current month and must not be before the hire month.
- Creating an employee takes the details plus a first salary `{ amount, effectiveMonth }`.
  `effectiveMonth` defaults to `payroll_from`.
- **Link:** a staff profile of the clinic, not a dentist, and not linked to another live
  employee (409 `payroll.user_already_linked`). An unlink is allowed at any time. Neither touches
  roles or access.
- **Left:** `endDate` must be on or after `hireDate`. It is refused when a paid line falls after
  the end month (409 `payroll.paid_outside_employment`, which also guards a later hire date or first payroll month).
  - The first and last employed months show "Joined on …" and "Left on …". Nothing is
    pro-rated.
  - **Undo leave** clears the end date.
- **Lines:**
  - **Status:** `paid` (a live payment), `skipped`, or else `pending`.
  - **Base:** the salary in force. With none, the base is null and the line can't be confirmed.
  - **Adjustments:** each adjustment adds its effect: a bonus adds `+amount` (amount > 0), a
    deduction adds `−amount` (amount > 0), and _Other_ adds its signed amount (≠ 0).
  - **Net:** `base + Σ effects`, shown as `max(0, …)`. The helpers `adjustmentEffect` and
    `netPay` live in contracts, used by the API and the SPA.
  - **Editing adjustments:** `PUT` the whole adjustment list of a pending line. It is refused
    when the net would fall below zero (422 `payroll.net_negative`).
- **Confirm** works on 1 to 50 lines, each carrying `employeeId`, `month`, `paidOn` (at most
  today), `method`, `note` and the `net` the user saw.
  - A line that is not pending, has no base, or has a net ≤ 0 is refused (409
    `payroll.line_not_pending`, 422 `payroll.no_salary`, 422 `payroll.net_not_positive`).
  - A net different from the one sent is refused (409 `payroll.stale`): someone changed the
    line in between.
  - Each confirmation stores a payment (base, adjustments snapshot, net), sets the line to
    `paid`, and publishes `PayrollPaymentConfirmed`. `expenses` then writes the _Salaries_ row:
    payee = the employee's name, branch = the employee's branch, `source_month` = the month.
  - The whole batch is one transaction. Retries with the same key return the same result.
- **Skip** needs a reason. **Undo skip** goes back to pending.
- **Void** a paid line with a reason. The payment is voided, the line goes back to `pending`,
  and its adjustments stay. `PayrollPaymentVoided` makes `expenses` void the _Salaries_ row with
  the same reason.
- One employee's writes run one at a time, under an advisory lock on the employee.

### Currency lock

`expenses` refuses `TenantCurrencyChanged` once any expense or fixed expense exists. `payroll`
refuses it once any salary entry exists. Both refusals are in the transaction and use the code
`tenant.currency_locked`.

## Routes (`/api/v1`)

**Expenses.** Every read needs `expense:read`; every write needs `expense:manage`.

| Route                                                                                  | Notes                                                                                                                                                |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /expenses/categories`                                                             | all, active and inactive, each with `inUse`                                                                                                          |
| `POST /expenses/categories` · `PATCH /expenses/categories/:id` · `DELETE …/:id`        | create custom; `{ name?, active? }`; delete if never used                                                                                            |
| `GET /expenses?from&to&categoryId&branchId&method&q&includeVoided&cursor&limit`        | newest first; `{ items, nextCursor, total: { amount, count }, byCategory: [{ categoryId, amount, count }] }` over the whole filter (voided excluded) |
| `GET /expenses/year?year=`                                                             | 12 months `{ month, amount, count }` and the year's total                                                                                            |
| `GET /expenses/export?…filters&lang=`                                                  | CSV of the filtered list                                                                                                                             |
| `POST /expenses` (Idempotency-Key) · `PATCH /expenses/:id` · `POST /expenses/:id/void` |                                                                                                                                                      |
| `GET /expenses/dashboard`                                                              | this month: `{ month, total, count, recent (8), pending }`. `manual` and `fixed` sources only, for everyone                                          |
| `GET /expenses/pending`                                                                | every pending item, oldest first (runs the catch-up)                                                                                                 |
| `POST /expenses/pending/confirm` (Idempotency-Key)                                     | `{ items: [...] }` → the expenses                                                                                                                    |
| `POST /expenses/pending/:id/skip` · `…/unskip`                                         | `{ reason? }`                                                                                                                                        |
| `GET /expenses/fixed` · `GET /expenses/fixed/:id`                                      | the list; one template with all its items                                                                                                            |
| `POST /expenses/fixed` · `PATCH /expenses/fixed/:id` · `POST …/:id/pause\|resume\|end` |                                                                                                                                                      |

**Payroll.** Every read needs `payroll:read`; every write needs `payroll:manage`.

| Route                                                                       | Notes                                                                                                                                              |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /payroll/employees?q&status&branchId`                                  | each with current salary, linked user name, `linkNotice` (`deactivated` / `dentist` / null)                                                        |
| `GET /payroll/staff`                                                        | linkable staff: active, not dentists; already-linked ones flagged                                                                                  |
| `POST /payroll/employees` · `PATCH /payroll/employees/:id` · `DELETE …/:id` | the patch covers details, `staffProfileId` (link and unlink) and `status`/`endDate` (leave and undo); each kind of change has its own audit action |
| `GET /payroll/employees/:id`                                                | details, salary history (newest first, with who and when), payroll history (every employed month, with voided payments)                            |
| `POST /payroll/employees/:id/salaries`                                      | `{ amount, effectiveMonth, reason? }`                                                                                                              |
| `GET /payroll/employees/:id/export?lang=`                                   | the employee's payroll history as CSV                                                                                                              |
| `GET /payroll/runs/:month`                                                  | lines + totals `{ employees, paidNet, pendingNet, skipped }` + `earlierPending: [{ month, count }]`                                                |
| `PUT /payroll/runs/:month/lines/:employeeId/adjustments`                    | `{ adjustments: [...] }`                                                                                                                           |
| `POST /payroll/confirm` (Idempotency-Key)                                   | `{ lines: [...] }`                                                                                                                                 |
| `POST /payroll/runs/:month/lines/:employeeId/skip\|unskip\|void`            | skip and void need `{ reason }`                                                                                                                    |
| `GET /payroll/months?year=` · `GET /payroll/months/export?year=&lang=`      | the net paid per month (and the count of lines still pending)                                                                                      |

## Audit

The actions are `resource.verb`. `areaOfAction` maps the prefixes `expense`, `expense_category`,
`fixed_expense` and `fixed_expense_item` to a new **`expenses`** area, and `employee`,
`employee_salary` and `payroll_line` to a new **`payroll`** area.

- `expense.record | update | void`
- `expense_category.create | rename | deactivate | reactivate | delete`
- `fixed_expense.create | update | pause | resume | end`
- `fixed_expense_item.confirm | skip | unskip`. A confirm also writes `expense.record`, hidden
  from the feed, so the sentence is said once.
- `employee.create | update | link | unlink | leave | rejoin | remove`
- `employee_salary.change`, with `{ from, to, effectiveMonth }`
- `payroll_line.adjust | confirm | skip | unskip | void`

Mirrored expense rows are not audited twice: the payout or the payroll confirmation is the
record.

Snapshots carry the names the Activity sentence needs: category, employee, template name,
amount, currency, month.

`AuditService.list` gains `withoutExpenses` (without `expense:read`) and `withoutPayroll`
(without `payroll:read`). These filter by resource type, plus `PAYROLL_EVENTS` for the stored
`PayrollPayment*` events. Platform Activity always applies `withoutPayroll`.

## Screens (web)

- **Nav:** **Expenses** (`/expenses`, `expense:read`) and **Payroll** (`/payroll`,
  `payroll:read`) in the main group, after Compensation. Today opens for `visit:read` or
  `expense:read`.
- **Today › This month's expenses** (`expense:read`), from `GET /expenses/dashboard`:
  - The total and count, the 8 latest expenses and _See all_, which opens `/expenses` on the
    current month.
  - **Waiting for confirmation**, with _Confirm_ (for `expense:manage`) opening the confirm
    dialog.
- **Expenses** (`/expenses`), with tabs that keep their state in the URL:
  - **History.** Filters: month (← →) or a range, category, branch, method, search, and _Show
    voided_. Above the list sit the waiting strip and the by-category chips; clicking a chip
    filters on its category. The list has a footer total, _Record expense_ (a side panel), Edit
    (the same panel), Void (a reason dialog) and Export.
  - **Year.** A month-by-month table. Each month opens History on that month.
  - **Fixed.** Templates with their status, usual amount and next month. A template's panel
    lists all its items (Confirm, Skip, Undo skip) and offers Edit, Pause, Resume and End.
  - **Categories** (`expense:manage`). Add, rename, deactivate, reactivate, and delete when
    unused.
  - **The confirm dialog** lists each selected item with its month and editable fields (amount,
    date, method, payee, reference, branch, category, description), and the batch total. One
    _Confirm N expenses_ button.
- **Payroll** (`/payroll`), with these tabs:
  - **Run** (`?month=`, defaults to the current month). The lines show status pills (Pending
    amber, Paid green, Skipped grey, voided payments struck through under the line), plus the
    month totals and a banner for earlier months still pending.
  - Per line: Adjust (a dialog with live net), Confirm, Skip, Undo skip and Void. Selecting
    several lines offers _Confirm N_, a dialog listing each net and its adjustments.
  - **Employees.** Search and filters, Add, and an employee panel with details, edit,
    link/unlink, _Mark as left_, _Change salary_, salary history and payroll history, with
    export.
  - **Year.** The net paid per month, with export.
- **Activity:** the two new areas appear in the area filter only for those who may read them.
  The new actions get sentences.
- **Settings › Roles and staff:** the two capability groups are labelled in three languages, and
  implications tick themselves (the existing editor).
- **Strings:** new `expenses.json` and `payroll.json` in en, ar and fr. Logical CSS, the shared
  date and money formatters, and the clinic's time zone. The pages print acceptably: no special
  print view, the sidebar is hidden by the existing print CSS.

## Tests

- **Domain:** `expenses/domain` (the catch-up months, with pause and resume, ended, future first
  month, the zone around midnight; the category rules) and `payroll/domain` (employed months,
  with hire and leave months, `payroll_from`, end before or after; the salary in force for a
  month, with ties; the back-dating rule; line status and net). Also `netPay` in contracts.
- **Integration:**
  - `expenses.int-spec.ts`:
    - categories: acceptance, plus duplicate across languages and delete of an unused one;
    - record, edit and void with their audit;
    - fixed: the Sep–Nov acceptance with the app clock, confirm, skip, undo, void back to
      pending, and the batch;
    - idempotency, the dashboard, a visibility matrix for payroll and compensation rows, an
      export smoke test, and the currency lock.
  - `payroll.int-spec.ts`:
    - employees, link rules (dentist refused, one employee per user) and a deactivated linked
      user;
    - salary history and back-dating;
    - the run: adjust, confirm creating the _Salaries_ expense, a double confirm refused, stale
      net, void, skip and undo;
    - a left employee, idempotency, and the platform admin denied;
    - the compensation mirror (payout recorded and voided), and the audit feed filters.
  - Tenant isolation: the new routes in `tenant-isolation-services.int-spec.ts`, and the new
    tables in the RLS list.
- **Web specs** only where there is logic:
  - the confirm dialogs (amounts edited per row, total), the adjustment dialog's net;
  - nav and Today card gating;
  - Activity sentences.
- **e2e** (`expenses-payroll.spec.ts`): fixed expense → confirm → Today card → history; employee
  → salary change → payroll → confirm → void.

## Agreed with the owner (2026-11-06)

All four of my calls were accepted as proposed: the dashboard is the Today board (D6); predefined
categories deactivate but don't rename (D7); a new salary takes effect after the last paid month
(D4); _Left_ plus a soft _Remove_ without payroll, no separate archive (D8).

## Out of scope

The out-of-scope list in the prompt, plus:

- a linked user turning into a dentist does not unlink by itself;
- printed views beyond the browser's print;
- the assistant's tools.
