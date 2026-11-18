# Lab orders and lab accounts — design

Feature 18. Written 2026-11-11 from the feature prompt (business requirements, decisions O1–O11
taken with the owner). The gap review the prompt points to (`mvp/18-lab-orders-gap-review.md`)
was not available; this design works from the prompt alone. Everything marked **(my call)** is
proposed and open to the owner; the layout questions are listed at the end.

## Problem

A dentist orders lab work (crowns, guards, dentures) for a patient. Today nothing in the system
knows the work exists, so the clinic finds out at the chair that it never came back. The owner
wants every open order on track or on someone's screen with a one-click action before the patient
sits down, and wants to know what the clinic owes each lab. Lab money is counted once: an order's
cost is owed to the lab, and only a payment to the lab is an expense.

## Decisions from the prompt (not reopened)

- **O1.** Sending happens outside the system. The system records it and prints the slip; it sends
  nothing.
- **O2.** One order, several trips, one number.
- **O3.** The turnaround counts from the sent date, in calendar days. The date promised at sending
  is what the lab is judged on.
- **O4.** An order links to at most one appointment and follows it when it is rescheduled.
- **O5.** Nothing closes by itself: a person marks sent, received and done.
- **O6.** The cost is owed when the work first arrives; until then it is in progress.
- **O7.** Payments are made to a lab's account, never to single orders. Each one appears in
  Expenses under _Lab fees_.
- **O8.** Prices and balances are hidden from those who only work with orders.
- **O9.** Lab orders belong to the patient record, not to a dentist's own visits.
- **O10.** Clinic currency only.
- **O11.** Today shows exceptions only.

## Design decisions

- **D1. A new module, `labs` (ADR-0081).** It owns labs, their services, orders, trips, the
  order's files links, payments, adjustments and the counter. It depends on `patients`, `users`,
  `tenancy`, `clinical` (a visit's patient, dentist and number; plan items), `scheduling`
  (appointments, opening hours, the appointment events) and `files` (an attachment is the
  patient's). **No existing module imports `labs`**, except `expenses`, which imports its payment
  events (as the prompt asks, and as it does for `payroll`). Three reads that mix lab data into
  another module's screen are composed without a new edge:
  - **The patients list filter** _Has open lab order_ is served by `GET /labs/patients`, which
    runs `PatientsService.search` with `idsIn` = the patients with an open order, exactly like
    `GET /billing/patients` (4b, Q5). `GET /patients` answers `lab=open` with 400.
  - **The booking warning** is shown by the SPA: the new-appointment panel, the move mode and the
    edit panel read the patient's open orders (`GET /lab-orders/open`, cached) and compare the
    chosen day with each order's expected date. Scheduling's API does not know about it. The
    warning is advisory (no override), so nothing on the server needs to enforce it.
  - **Today's Lab work lane**, the record's _Needs attention_, the start-visit popover, the
    Complete step and the calendar marks read `labs` routes from the SPA.
- **D2. Trips (ADR-0082).** An order has a status and an ordered list of **trips**. _Mark sent_
  opens a trip (sent date, how, reference, expected and promised dates). _Mark received_ closes it
  (received date, note). What happens after the work arrived is the trip's **outcome**: `next_stage`
  or `adjustment` (status back to _To send_) or `remake` (status _Remake_, with a reason and who
  bears it, and for the clinic a charge). _Fitted_ / _Mark done_ makes the order _Done_. The next
  _Mark sent_ opens the next trip. Statuses: `to_send`, `at_lab`, `arrived`, `done`, `on_hold`,
  `remake`, `cancelled`.
  - **Undo, one step back** (all audited): sent → the status before it (`to_send` or `remake`;
    the open trip is removed); received → `at_lab`; done → `arrived`; an outcome → `arrived` (the
    outcome cleared); cancel → the status it was cancelled from. Hold is undone by _Resume_.
  - **Date corrections:** a trip's sent and received dates can be corrected (`received ≥ sent`,
    never in the future). Correcting a sent date moves the expected and promised dates by the same
    number of days **(my call)**: the turnaround promised did not change.
- **D3. The cost is owed on first arrival; the account is derived (ADR-0083).**
  - An order's `cost` is the estimate (Σ price × quantity of its priced items, prices snapshot at
    creation) until someone with `lab:money_manage` sets it; from then on it is kept
    (`cost_set_by_hand`). Editing items recalculates an estimate, never a hand-set cost.
  - `first_received_on` is the day the work first arrived (undoing that first arrival clears it).
  - The **account** is computed, never stored: `owed = opening balance + Σ cost of orders with a
first arrival + Σ clinic-borne remake charges + Σ cancellation charges + Σ charges − Σ credits`,
    `outstanding = owed − Σ live payments`. It may be negative. A cost edited later moves the
    account; the audit keeps the before and after.
  - **In progress:** orders with at least one trip and no first arrival, not cancelled, at their
    estimated cost. Not part of the outstanding amount.
  - **Cancel:** before any trip, free. Sent but never arrived: the user states what the lab still
    charges (default 0), owed on the cancel date. After a first arrival the delivered cost stays
    owed and no charge is asked **(my call)**.
- **D4. The appointment link follows scheduling (ADR-0084).** `labs` reacts **in the
  transaction** to scheduling's events (exported from its `index.ts`):
  - `AppointmentBooked`: every open, not-done order of that patient **without an upcoming link**
    links to it, the same dentist's orders first **(my call: every unlinked open order links, not
    only the same dentist's; the same-dentist rule decides only when the patient books two at
    once)**. Audited as `lab_order.link` with `by: system`.
  - `AppointmentRescheduled` (also an edit that moves): the link moves to the new appointment.
  - `AppointmentCancelled`, `AppointmentMarkedNoShow`, `AppointmentCompleted`: the link is
    removed (`lab_order.unlink`, `by: system`). The order then waits for the next booking.
    _Completed_ is my addition: an order still _Arrived_ after the visit (_Not used today_) has no
    upcoming appointment, so it shows on Today as _Book appointment_ and links to the next one.
  - `AppointmentRestored`: nothing (the user re-links if wanted).
  - A user may set, change or remove the link at any time: the appointment must be the patient's,
    upcoming and active (`booked`, `confirmed`, `checked_in`, `in_room`).
  - At creation the form proposes the next upcoming appointment with the same dentist, else the
    patient's next one, else none (`GET /lab-orders/proposal?patientId&dentistId`).
- **D5. Lab payments are mirrored into Expenses (ADR-0085).** `LabPaymentRecorded` and
  `LabPaymentVoided` are published in the payment's transaction. `expenses` reacts in the
  transaction like the payroll mirror: a read-only row with the new source **`lab`**, category
  `lab_fees` (still selectable by hand; never reserved), payee = the lab's name. Visible to
  everyone with `expense:read`, counted in month totals and in Today's card (the dashboard's
  sources become `manual`, `fixed`, `lab`). Refused for edit and void from Expenses
  (`expense.system_row`). Opening balances, adjustments and order costs are not expenses.
- **D6. Permissions (ADR-0086).** `lab:read`, `lab:manage`, `lab:money_read`,
  `lab:money_manage`, a new capability group `lab`. Implications: `lab:manage ⇒
lab:read`, `lab:money_manage ⇒ lab:money_read`, `lab:money_read ⇒ lab:read`. Owner
  and admin hold all four; dentist, assistant and front desk hold `lab:read` and `lab:manage`. A platform admin
  holds them like any other non-payroll permission. Migration 0059 only adds.
  - Without `lab:money_read`, every response leaves out prices, costs, charges and balances (the
    fields are `null`), the Labs money routes answer 403, and the reports carry no cost columns.
- **D7. Order numbers** come from `lab_order_counters` (one row per tenant, locked increment),
  shown `L-000123` like visits (`V-000123`). Never reused.
- **D8. Next open day** = the first day after today (clinic time zone) whose weekday is open in
  the order's branch's opening hours (scheduling's `branch_opening_hours`). With no open weekday
  it is tomorrow. A pure function in `labs/domain`.
- **D9. Labels (contracts `labOrderLabel`).** From the order and today: `to_send` (_Not sent_),
  `at_lab` (_Sent · due 20 Nov_, with `due`), `due_soon` (at the lab and expected within
  `LAB_EXPECTED_SOON_DAYS`: _Due today / tomorrow / in n days_, with `due` and `daysLeft`), `late`
  (_Overdue · n days_, with `daysLate`), `arrived`, `on_hold`, `remake`. A **tone** for the
  calendar mark: `arrived`; `late`; `at_risk` (not arrived and the appointment's day is on or
  before the expected date, or not sent yet); else `on_track`. **Urgency** for "most urgent + a
  count": overdue, due soon, remake, not sent, on hold, sent, arrived. Computed in the API (it
  knows today) and returned with every order; the words and the styles come from one SPA module
  (`lab-words.ts`): not sent is neutral with a dashed outline, sent indigo, due soon amber and
  bold, overdue solid red and bold, arrived green. On Today's lane each row has a leading edge in
  the same colour, two short lines (the patient and the label; the lab, the first item and the
  appointment) and its one action; hovering or clicking the row shows the rest (order number,
  every item, lab phone, dentist, dates) with _Open order_, _New expected date_ and _Reschedule_.

## Data (migration 0059, additive)

Every table is a tenant table (`tenantColumns`, RLS, `tenant_id` index, `created_at`,
`updated_at`). Money `numeric(12,2)` + `currency`. Tooth codes are the stored FDI codes
(`toothCodeSchema`), shown in the clinic's notation. No foreign key to another module's table.

| Table                | Columns (beyond the standard)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Notes                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `labs`               | `name`, `contact_person`, `phone`, `email`, `address`, `delivery_methods` text[] (`courier`, `email`; ≥ 1), `portal_url`, `turnaround_days` (1–365), `note`, `active`, `opening_balance` null, `opening_balance_on` null, `currency`, `created_by`                                                                                                                                                                                                                                                                             | unique `(tenant, lower(name))`; no DELETE                                                                                    |
| `lab_services`       | `lab_id`, `name`, `price` ≥ 0, `currency`, `turnaround_days` null, `active`, `created_by`                                                                                                                                                                                                                                                                                                                                                                                                                                      | unique `(lab_id, lower(name))`; no DELETE                                                                                    |
| `lab_order_counters` | `tenant_id` pk, `last_value`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |                                                                                                                              |
| `lab_orders`         | `display_number`, `patient_id`, `dentist_id` (staff profile), `lab_id`, `branch_id`, `visit_id`, `appointment_id`, `status`, `held_from`, `cancelled_from`, `priority` (`normal`/`urgent`), `submission` (`physical`/`digital`), `lab_case_ref`, `lab_case_url`, `expected_days`, `notes`, `plan_ids` uuid[], `cost`, `cost_set_by_hand`, `currency`, `first_received_on`, `waiting_since` date (created or last sent back), `done_on`, `cancel_reason`, `cancel_charge`, `cancelled_on`, `created_by`, idempotency key + hash | unique `(tenant, display_number)`; indexes `(tenant, status)`, `(tenant, patient_id)`, `(tenant, appointment_id)`; no DELETE |
| `lab_order_items`    | `order_id`, `position`, `service_id` null, `description` (the service's name, or the free text), `unit_price` null (snapshot), `turnaround_days` null (snapshot), `quantity` (1–99), `shade`, `target` (`teeth`/`upper`/`lower`/`both`), `teeth` text[]                                                                                                                                                                                                                                                                        | replaced as a list on edit (hard delete: the order's content)                                                                |
| `lab_order_trips`    | `order_id`, `seq`, `sent_on`, `sent_via` (`courier`/`email`/`lab_software`), `sent_reference`, `promised_on`, `expected_on`, `received_on`, `received_note`, `outcome` (`next_stage`/`adjustment`/`remake`), `outcome_note`, `remake_reason` (`fit`/`shade`/`fracture`/`impression`/`other`), `remake_borne_by` (`lab`/`clinic`), `remake_charge`, `outcome_on`                                                                                                                                                                | unique `(order_id, seq)`; deleted only by _Undo sent_                                                                        |
| `lab_order_files`    | `order_id`, `file_id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | junction: pk `(order_id, file_id)`                                                                                           |
| `lab_payments`       | `lab_id`, `paid_on`, `amount` > 0, `currency`, `method`, `reference`, `note`, `created_by`, void columns, idempotency key + hash                                                                                                                                                                                                                                                                                                                                                                                               | UPDATE only on the void columns                                                                                              |
| `lab_adjustments`    | `lab_id`, `on_date`, `kind` (`credit`/`charge`), `amount` > 0, `reason`, `created_by`, idempotency key + hash                                                                                                                                                                                                                                                                                                                                                                                                                  | append-only                                                                                                                  |

`expenses` gains the source `lab` (its check constraint and the mirror's unique index are
recreated to include it). Migration 0059 also adds the four permissions to every clinic's system
roles as D6 says, and to the five templates, `ON CONFLICT DO NOTHING`.

## Rules

### Labs and services (`lab:money_manage` to write; reads need `lab:read`)

- Name 1–80, unique per clinic case-insensitively (409 `lab.name_taken`). Delivery methods ≥ 1.
  A portal link is an `https?://` URL. Turnaround 1–365 days.
- A service: name 1–80, unique within its lab (409 `lab.service_name_taken`), price ≥ 0, optional
  turnaround 1–365. A changed price applies to new orders only (orders snapshot it).
- Inactive labs and services are not offered for new orders (422 `lab.inactive`,
  `lab.service_inactive`) and stay on old ones. Never deleted.
- Without `lab:money_read` the directory has no prices.

### Orders (`lab:manage` to write, `lab:read` to read)

- **Create** (`Idempotency-Key`): `patientId`, `dentistId` (an active practitioner), `labId`
  (active), `branchId` (active), `visitId` (optional: a live visit of that patient), `items`
  (1–20: a `serviceId` of that lab, active, or a free `description`; `quantity`; `shade` ≤ 20;
  `target` with `teeth` (1–32 distinct codes) when `teeth`), `priority`, `submission`,
  `labCaseRef`, `labCaseUrl` (digital only), `expectedDays` (default: the longest item
  turnaround, else the lab's), `notes` ≤ 2000, `planIds` (the patient's open plan items),
  `appointmentId` (optional, D4 rules), `fileIds` (the patient's files), `cost` (only with
  `lab:money_manage`; otherwise the estimate). Status `to_send`, `waiting_since` = today.
- **Edit** (`PATCH`): anything of the above but the patient. The lab can't change once a trip
  exists (409 `lab_order.lab_locked`). `cost` needs `lab:money_manage`. Not on `done` or
  `cancelled` (409 `lab_order.closed`). Audited field by field (prices left out of the snapshot).
- **Mark sent** `{ sentOn ≤ today, via, reference? }` from `to_send` or `remake`: a trip with
  `promised_on = expected_on = sentOn + expectedDays`. Status `at_lab`.
- **Mark received** `{ receivedOn (sentOn ≤ … ≤ today), note? }` from `at_lab`; batch of 1–50
  orders with one date. Sets `first_received_on` once. Status `arrived`.
- **New expected date** `{ expectedOn ≥ sentOn }` on `at_lab`: changes `expected_on` only.
- **Outcome** on `arrived`: `fitted` → `done` (`done_on` = today); `next_stage` / `adjustment`
  `{ note? }` → `to_send`; `remake` `{ reason, borneBy, charge? (clinic only, ≥ 0, needs
`lab:money_manage` to be non-zero — else 0) , note? }` → `remake`. Sent back sets
  `waiting_since` = today. **Mark done** by hand is the same as _Fitted_.
- **Hold** `{ reason }` from `to_send` or `at_lab` (`held_from`); **Resume** back to it.
- **Cancel** `{ reason, charge? }` from any status but `done`/`cancelled` (D3).
- **Undo** `{ step: 'sent' | 'received' | 'done' | 'outcome' | 'cancel' }` (D2): refused when
  the order is not in the state that step left (409 `lab_order.undo_unavailable`).
- **Correct trip dates** `{ sentOn?, receivedOn? }` on any trip of an open order.
- **Link** `{ appointmentId | null }`; **attachments** `{ fileIds }` replaces the list (files of
  the patient, `file:write` not required: they were uploaded through Files).
- An illegal move is 409 `lab_order.transition`. Dates in the future are 422
  `lab_order.future_date`.
- One order's writes run under `SELECT … FOR UPDATE` on the order.

### Lateness, Today lane (all in the clinic time zone)

- **Late:** `at_lab` and today > `expected_on`. On hold is never late.
- **Lane** (`GET /lab-orders/today?branchId`), orders of that branch, each once, under its most
  urgent reason: 1 `late`; 2 `due` (not arrived, i.e. `to_send`/`at_lab`/`remake`/`on_hold`, and
  its appointment is today or on the branch's next open day); 3 `not_sent` (`to_send`/`remake`,
  from the day it is created: _Mark sent_ is the next step); 4 `expected` (`at_lab`, expected
  within `LAB_EXPECTED_SOON_DAYS` = 3 days); 5 `book` (`arrived`, no appointment link). Within a
  reason: urgent first, then the earliest date (expected, appointment, waiting since, arrival).

### Lab money (`lab:money_read` to read, `lab:money_manage` to write)

- **Opening balance** `PUT /labs/:id/opening-balance { amount (may be 0 or negative), asOf ≤
today }` — a replace, so a retry never duplicates. Audited before/after.
- **Payment** (`Idempotency-Key`) `{ paidOn ≤ today, amount > 0, method, reference?, note? }`;
  **void** `{ reason }` keeps it, struck through. Events as D5.
- **Adjustment** (`Idempotency-Key`) `{ onDate ≤ today, kind, amount > 0, reason }`. Append-only.
- **Statement** `GET /labs/:id/statement?from&to`: the balance before `from`, then every line in
  the period (opening balance, delivered orders at their cost, remake charges, cancel charges,
  adjustments, payments with voided ones flagged), with a running balance; CSV export.
- **Accounts** `GET /labs/accounts`: per lab `owed`, `paid`, `outstanding`, `inProgress` (count,
  estimated amount); and the clinic totals.
- **Currency lock:** `TenantCurrencyChanged` is refused once any lab has an opening balance or a
  service, or any order, payment or adjustment exists (`tenant.currency_locked`).

### Reports (`GET /labs/reports?from&to&groupBy=lab|dentist|service`)

Per group and for the clinic, over the period (by the date each event happened):
`sent` (trips sent), `received` (trips received), `done`, `cancelled`; `avgTurnaround` (received −
sent, per trip received); `onTime` (share of trips received on or before `promised_on`) and
`avgDelay` (days late among the late ones); `remakeRate` (orders with a remake outcome among
orders with a trip received), split `lab`/`clinic`; `adjustmentRate`; with `lab:money_read`,
`totalCost` (delivered orders' cost + charges in the period) and `avgCost` per delivered order.
Each figure carries the order ids behind it; the SPA opens them in the orders list (`ids=`).
By service, an order counts under each of its services.

### Patients

- **Merge** (`PatientsMerged`, in the transaction): the dropped patient's orders move to the kept
  one.
- **Archive** (`PatientArchived`, in the transaction): refused with 409
  `lab_order.patient_has_open_orders` while an order is open (`to_send`, `at_lab`, `arrived`,
  `on_hold`, `remake`).

## Routes (`/api/v1`)

| Route                                                                                                                              | Access                      | Notes                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------- |
| `GET /labs?includeInactive`                                                                                                        | `lab:read`                  | labs with their services; prices only with `lab:money_read`                           |
| `POST /labs` · `PATCH /labs/:id` · `POST /labs/:id/services` · `PATCH /labs/:id/services/:serviceId`                               | `lab:money_manage`          |                                                                                       |
| `GET /labs/accounts` · `GET /labs/:id/statement?from&to` · `GET /labs/:id/statement/export`                                        | `lab:money_read`            |                                                                                       |
| `PUT /labs/:id/opening-balance` · `POST /labs/:id/payments` · `POST /labs/payments/:id/void` · `POST /labs/:id/adjustments`        | `lab:money_manage`          | payments and adjustments need `Idempotency-Key`                                       |
| `GET /labs/reports?from&to&groupBy`                                                                                                | `lab:read`                  | costs only with `lab:money_read`                                                      |
| `GET /labs/patients?…patient list query`                                                                                           | `patient:read` + `lab:read` | the _Has open lab order_ list                                                         |
| `GET /lab-orders?status&labId&dentistId&branchId&late&from&to&q&ids&patientId&cursor&limit`                                        | `lab:read`                  | newest first; `q` matches `L-123`, `123` or the patient's name                        |
| `GET /lab-orders/export?…`                                                                                                         | `lab:read`                  | CSV                                                                                   |
| `GET /lab-orders/open`                                                                                                             | `lab:read`                  | every open order, compact, with its label: the labels everywhere, the booking warning |
| `GET /lab-orders/today?branchId`                                                                                                   | `lab:read`                  | the lane                                                                              |
| `GET /lab-orders/proposal?patientId&dentistId`                                                                                     | `lab:read`                  | the appointment to propose (D4)                                                       |
| `GET /lab-orders/:id`                                                                                                              | `lab:read`                  | the order with items, trips, files, appointment, history                              |
| `POST /lab-orders` (Idempotency-Key) · `PATCH /lab-orders/:id`                                                                     | `lab:manage`                |                                                                                       |
| `POST /lab-orders/:id/send\|expected\|outcome\|hold\|resume\|cancel\|undo\|link\|attachments` · `PATCH /lab-orders/:id/trips/:seq` | `lab:manage`                |                                                                                       |
| `POST /lab-orders/receive`                                                                                                         | `lab:manage`                | `{ orderIds (1–50), receivedOn, note? }`                                              |

## Audit

Area **`labs`**; prefixes `lab`, `lab_service`, `lab_order`, `lab_payment`, `lab_adjustment`.
Actions: `lab.create | update | opening_balance`, `lab_service.create | update`,
`lab_order.create | update | send | receive | expected | done | send_back | remake | hold |
resume | cancel | undo | link | unlink | relink | cost | trip_dates | attachments`,
`lab_payment.record | void`, `lab_adjustment.record`. Order rows set `patient_id` (and `visit_id`
when the order has one) through `AuditService.about()`; link rows say `by: 'system' | 'user'`.
Snapshots carry the names a sentence needs (order number, lab name, items' descriptions).
`AuditService.list` gains `withoutLabMoney` (without `lab:money_read`): hides `lab_service`,
`lab_payment`, `lab_adjustment`, the actions `lab.opening_balance` and `lab_order.cost`, and the
stored `LabPayment*` events. No order snapshot outside `lab_order.cost` holds a price.

## Screens (web)

- **Nav:** **Lab** (`/lab`, `lab:read`) after Schedule, with tabs **Orders**, **Labs**,
  **Reports** (the Expenses page pattern: tabs in the URL).
  - **Orders:** the clinic list with the filters, a search box focused on open that finds an
    order number or a patient at once, row checkboxes and _Mark received_ for several, export.
    A row opens the **order panel** (side panel: details, items, trips, attachments, linked
    appointment, history and the actions for the status; _Print slip_, _Copy for email_).
  - **Labs:** the directory (name, contact, turnaround, active); with `lab:money_read` the
    outstanding and in-progress columns and the clinic total. A lab opens **its own page**
    (`/labs/:labId`, below); _Add lab_ is a short side panel that opens the new lab's page on its
    price list.
- **A lab's page** (`/labs/:labId`, the owner's call of 2026-11-12: too much for a side panel):
  the lab's name, contact and turnaround; with `lab:money_read` its figures (outstanding, owed,
  paid, in progress). Tabs: **Statement** (`lab:money_read`; a period — this month, last month,
  last 3 months, this year or custom — with the balance before, each movement and its running
  balance, the balance after; a payment can be voided with a reason; _Adjustment_, _Opening
  balance_, export, print), **Services and prices** (price with `lab:money_read`, turnaround or
  the lab's standard, active; add, edit, deactivate) and **Orders** (this lab's, open or all; a
  row opens the order panel). A **Details** card at the side. _Edit_ and _Record payment_ in the
  header with `lab:money_manage`. Every form is a right panel with errors shown when a field is
  left or on save, and a prompt before closing with changes: the lab, a service, a payment (with
  _Pay it all_), an adjustment (credit or charge, explained), the opening balance. The tab, the
  period and an open order are in the URL.
  - **Reports:** period, group by lab / dentist / service, the figures; a figure opens the orders
    behind it.
- **New lab order** (a side panel, the Expenses panel pattern): from the visit workspace (patient,
  dentist, visit, selected teeth filled; _Where_ starts on _Teeth_, and the teeth worked on in the
  visit are offered under each item's teeth, one click to add or remove), from the record's lab
  card and from the Lab screen.
- **Status label** `LabOrderLabel` and the calendar's **mark** (a small pill, _Lab pending_ or _Lab arrived_) in
  `features/labs/`, used by the patients list rows, the record, the calendar card and popover
  (full label, summary, _Mark received_), and Today's schedule rows.
- **Patients list:** the label in the row; a _Has open lab order_ chip in the filter bar (served
  by `/labs/patients`; disabled in the views served by billing).
- **Patient record:** an Overview **Lab work** card (open orders with detail and actions,
  _All orders_ for the history, _New lab order_); _Needs attention_ gains "Lab work late" and
  "Lab work arrived, no appointment".
- **Visit:** the start-visit popover lists arrived work and warns of work not arrived for this
  appointment; the workspace keeps a _Lab work arrived_ card and a _New lab order_ action; the
  Complete step lists each arrived order on one line with _Fitted · Back to the lab · Remake ·
  Not used today_ (left empty = stays arrived), applied after the visit completes. The Next
  appointment step offers a reason per open order no other appointment waits for, in the lab
  colour: _Fit {items}_ (the word of _Fitted_), with "Lab work expected {date}" (or _Arrived_, or
  the wait after sending), timed for when the work can be back, with the order's open plan items;
  the follow-up kind is `lab_work`.
- **Booking:** the new-appointment panel, move mode and edit panel show "Lab work expected on
  {date}" when the chosen day is before an open order's expected date (no override).
- **Today:** a **Lab work** lane (`lab:read`), rows only for the five reasons, actions for
  `lab:manage` (_Mark sent_ dated today — the lab's software for a digital case, else courier;
  _Mark received_ and _New expected date_ for late and expected work), _Undo_ after a handled row.
- **Expenses:** the `lab` source label _Labs_; choosing _Lab fees_ by hand shows the hint.
- **Activity:** the `labs` area, sentences for every action.
- **Strings:** `labs.json` in en, ar, fr; logical CSS; the shared date and money formatters.
- **Lab slip:** a `PrintSheet` document (no prices); the email text built from the same fields.

## Tests

- **Domain** (`labs/domain`): the status machine and every undo; trips and outcomes; expected and
  late dates around midnight in the clinic zone; the next open day (Saturday → Monday, no open
  day); the lane's reasons and order; the account arithmetic (opening, delivered, charges,
  credits, payments, voids, negative); the label, tone and urgency (contracts).
- **Integration** (`labs.int-spec.ts`): the acceptance in USD/Asia/Beirut with the app clock —
  labs and prices; create without prices for a dentist; send, book with the link, move, cancel;
  Today; receive and undo; outcomes and trips; hold and cancel with a charge; money and the
  expense mirror with void; reports; permissions (front desk, custom read-only role); idempotency;
  merge and archive veto; the currency lock; the audit filter.
- **Tenant isolation:** the new tables in the RLS list; the new routes in
  `tenant-isolation-services.int-spec.ts`.
- **Web specs** where there is logic: the order form (defaults, expected days, price hidden), the
  label component, the Today lane (rows, undo), the Complete step choices, nav gating.
- **e2e** (`lab-orders.spec.ts`): create in a visit → send → book → late on Today → receive →
  start visit → fitted → pay the lab → the expense.

## Out of scope

The prompt's list, plus: the link does not re-attach to a restored appointment by itself; no
void of an adjustment (a wrong one is corrected by its opposite); no lab-order assistant tools.

## Layout agreed with the owner (2026-11-11)

The three layout questions were answered as proposed: one **Lab** nav entry with Orders, Labs
and Reports tabs; an order opens in a **side panel**; the patient record shows lab work as an
**Overview card** with _All orders_ in a panel. The other calls marked **(my call)** above stand
until the owner says otherwise.

**2026-11-12:** the lab's _accepts digital cases_ switch (prompt A1) is dropped at the owner's
request: with no integration with lab software it decided nothing. A lab keeps its optional
portal link; an order still says whether it is submitted _Physical_ or _Digital_.

**2026-11-12:** a lab opens on its own page instead of a side panel, at the owner's request (see
_A lab's page_ above).

**2026-11-13**, at the owner's request: an order not sent yet is on Today's lane from the day it
is created, with _Mark sent_; an order at the lab joins the lane 3 days before it is expected
(reason `expected`); a visit's New lab order starts on _Teeth_ and offers the teeth the visit
worked on.

**2026-11-17**, at the owner's request: the four kinds of lab work (not sent, sent, due soon,
overdue) look different everywhere (D9), and Today's lane rows are brief with the details on hover
or click.

**2026-11-18**, at the owner's request: an appointment's lab mark, on its calendar card and its
row on Today, is a small pill instead of a dot: amber _Lab pending_ while any of its work is still
to come, an alert, and green _Lab arrived_ once all of it is in; its tooltip gives the most urgent
order's label.
