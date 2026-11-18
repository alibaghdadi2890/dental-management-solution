# `labs` module

**Status:** implemented for feature 18 (API and SPA); the end-to-end flow is still to write. ADR-0081 to
ADR-0086; spec `docs/superpowers/specs/2026-11-11-lab-orders-design.md`.

## Purpose

The dental laboratories a clinic works with and their price lists; the lab work ordered for
patients, followed trip by trip until it is fitted; and what the clinic owes each lab and what it
paid. Lab work never surprises the clinic at the chair: every open order is on track or on
someone's screen (Today's Lab work lane). An order's cost is owed; only a payment is an expense.

## Depends on

- `patients`: names and numbers, the lock for a dependent write, the patients search (the filter)
- `users`: practitioners (the order's dentist, names)
- `tenancy`: currency, time zone, branches, locale
- `clinical`: a visit's patient and number (`refsFor`, `numbersFor`), plan items' patient
  (`planOwners`)
- `scheduling`: appointments (`refs`, `upcomingFor`), opening hours (`openWeekdays`), and its
  booked, rescheduled, cancelled, no-show and completed events
- `files`: attachments are the patient's files (`refs`)
- `audit`

It reacts in the transaction to the appointment events (the link, ADR-0084), `PatientsMerged`
(orders move), `PatientArchived` (refused while an order is open) and `TenantCurrencyChanged`
(refused once lab money exists). It publishes `LabPaymentRecorded` and `LabPaymentVoided`, which
`expenses` mirrors (ADR-0085). Nothing else imports `labs`.

## Tables (migration 0059)

All are tenant tables with RLS.

| Table                | What                                                                                              | Rules                                       |
| -------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `labs`               | name, contact, delivery methods, portal, standard turnaround, active, opening balance             | unique name per clinic; never deleted       |
| `lab_services`       | a lab's price list: name, price, optional turnaround, active                                      | unique name per lab; never deleted          |
| `lab_order_counters` | the per-clinic order number                                                                       | `L-000123`, never reused                    |
| `lab_orders`         | patient, dentist, lab, branch, visit, appointment, status, priority, submission, cost, dates      | never deleted                               |
| `lab_order_items`    | what is ordered: service or free text, price and turnaround snapshot, quantity, shade, teeth/arch | replaced as a list on edit                  |
| `lab_order_trips`    | each trip: sent, promised, expected, received, outcome, remake reason, who bears it, charge       | removed only by _Undo sent_                 |
| `lab_order_files`    | the patient's files attached to an order                                                          | junction                                    |
| `lab_payments`       | payments to a lab's account                                                                       | voided with a reason (UPDATE only the void) |
| `lab_adjustments`    | credits and charges with a reason                                                                 | append-only                                 |

## Public API (`/api/v1`)

- `GET /labs`, `POST /labs`, `PATCH /labs/:id`, `POST /labs/:id/services`,
  `PATCH /labs/:id/services/:serviceId`
- `GET /labs/accounts`, `GET /labs/:id/statement`, `GET /labs/:id/statement/export`,
  `PUT /labs/:id/opening-balance`, `POST /labs/:id/payments`, `POST /labs/payments/:id/void`,
  `POST /labs/:id/adjustments`
- `GET /labs/reports?from&to&groupBy=lab|dentist|service`, `GET /labs/patients` (the filter)
- `GET /lab-orders`, `GET /lab-orders/export`, `GET /lab-orders/open`, `GET /lab-orders/today`,
  `GET /lab-orders/proposal`, `GET /lab-orders/:id`
- `POST /lab-orders`, `PATCH /lab-orders/:id`, `POST /lab-orders/receive`, and
  `POST /lab-orders/:id/send|expected|outcome|hold|resume|cancel|undo|link|attachments`,
  `PATCH /lab-orders/:id/trips/:seq`

Access (ADR-0086): `lab:read` for orders, the directory without prices and reports without costs;
`lab:manage` for every order change; `lab:money_read` for prices, costs and accounts;
`lab:money_manage` for labs, prices, costs and the account's entries. `POST /lab-orders`,
payments and adjustments need an `Idempotency-Key`.

## Rules worth knowing

- **Statuses and trips** (ADR-0082): `to_send` → _Mark sent_ → `at_lab` → _Mark received_ →
  `arrived` → _Fitted_ (`done`) or back (`to_send`, `remake`); _Hold_/_Resume_; _Cancel_ from any
  open status; one step back for each mark.
- **Late:** at the lab and today (clinic time zone) past the trip's expected date. On hold is
  never late. Reports judge the lab on the promised date.
- **Today's lane:** late; not arrived for an appointment today or on the branch's next open day;
  not sent yet; at the lab and expected within 3 days; arrived with no appointment. Each order
  once, most urgent first.
- **Money** (ADR-0083): cost owed from the first arrival; the account is computed; in progress is
  apart; payments are mirrored into Expenses.
- **Labels** (`labOrderLabel` in contracts): one label and tone everywhere, the most urgent with
  a count when there are several.

## Events

- `LabPaymentRecorded`, `LabPaymentVoided` (consumed by `expenses`; stored by the audit
  subscriber, hidden without `lab:money_read`).
