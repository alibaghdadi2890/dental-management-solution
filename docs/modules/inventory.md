# `inventory` module

**Status:** implemented for feature 20a (API and SPA). ADR-0094 to ADR-0101; spec
`docs/superpowers/specs/2026-11-19-inventory-design.md`. Run b (reading a supplier's invoice with
AI) is not built.

## Purpose

What the clinic stocks, per branch: the items and their categories, the deliveries received from
suppliers, the stock taken out as it is used, the counts, and what each supplier is owed and was
paid. The number on the screen is the number on the shelf: stock changes only through a movement
with an author and a reason. A receipt is what the clinic owes; only a payment is an expense.

## Depends on

- `tenancy`: currency, time zone ("today", expired, expiring), branches, locale (CSV exports)
- `users`: names of whoever recorded a movement, a receipt, a count
- `audit`

It consumes `TenantProvisioned` after the commit (the categories, ADR-0014) and vetoes
`TenantCurrencyChanged` once inventory money exists (a priced batch, an opening balance, a payment
or an adjustment). It publishes `SupplierPaymentRecorded` and `SupplierPaymentVoided`, which
`expenses` mirrors (ADR-0098). `imports` (items and opening stock) and `dashboards` (Stock card,
Suppliers, Needs attention) use its services. Nothing else imports it.

## Tables (migration 0062)

All are tenant tables with RLS.

| Table                            | What                                                                                     | Rules                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `inventory_categories`           | the twelve predefined (by key) and the clinic's own (by name)                            | the expense categories' rules                           |
| `inventory_items`                | name, code, category, unit, pack, reorder level, usual supplier and order, tracks expiry | unique name and code; never deleted; unit locks on move |
| `inventory_item_branches`        | per item and branch: own reorder level, _Ordered_, _To count_                            | created on first need                                   |
| `inventory_suppliers`            | the directory and the opening balance                                                    | unique name; never deleted                              |
| `inventory_receipt_counters`     | the per-clinic receipt number                                                            | `GR-000123`, never reused                               |
| `inventory_receipts`             | a delivery: supplier or one-off payee, branch, date, invoice, discount, charges          | voided with a reason, never deleted                     |
| `inventory_batches`              | a receipt's line, opening stock or a count's surplus: lot, expiry, cost, `quantity_left` | `quantity_left` ≥ 0, written only with a movement       |
| `inventory_movements`            | one change to one item in one branch: kind, quantity, reason, note, who, when            | append-only but for being reversed once                 |
| `inventory_movement_batches`     | which batches a movement changed and by how much                                         | append-only                                             |
| `inventory_counts`               | a count of a branch, all items or chosen categories                                      | one open per branch                                     |
| `inventory_count_lines`          | counted, `system_then`, the opening details, the difference applied                      |                                                         |
| `inventory_supplier_payments`    | payments to an account, or a one-off purchase's (no supplier)                            | voided with a reason (UPDATE only the void)             |
| `inventory_supplier_adjustments` | credits and charges with a reason                                                        | append-only                                             |
| `inventory_receipt_files`        | the invoice's photos and PDFs (the bytes in object storage)                              | ≤ 5 per receipt; pending until sealed                   |
| `inventory_settings`             | the expiring window (default 60 days)                                                    |                                                         |

## Public API (`/api/v1`)

- `GET|POST /inventory/categories`, `PATCH|DELETE /inventory/categories/:id`
- `GET|PUT /inventory/items`, `GET /inventory/items/:id`, `PUT /inventory/items/:id/branches/:branchId`,
  `PUT|DELETE /inventory/items/:id/branches/:branchId/ordered`, `POST /inventory/items/:id/report-count`,
  `POST /inventory/reorder/ordered`
- `GET /inventory/stock?branchId`, `GET /inventory/stock/export`, `GET /inventory/today?branchId`,
  `GET /inventory/reorder?branchId`, `GET /inventory/movements?…`
- `POST /inventory/take-outs`, `POST /inventory/movements/:id/undo|reverse`,
  `POST /inventory/adjustments`, `PUT /inventory/batches/:id/price`
- `GET|POST /inventory/receipts`, `GET|PATCH /inventory/receipts/:id`,
  `PUT /inventory/receipts/:id/prices`, `POST /inventory/receipts/:id/void`,
  `POST /inventory/receipts/:id/files/uploads`, `POST /inventory/receipts/:id/files`,
  `GET|DELETE /inventory/receipts/:id/files/:fileId`
- `GET|POST /inventory/counts`, `GET /inventory/counts/:id`, `PUT /inventory/counts/:id/lines/:itemId`,
  `POST /inventory/counts/:id/apply|discard`
- `GET|POST /inventory/suppliers`, `GET /inventory/suppliers/accounts`, `GET|PATCH /inventory/suppliers/:id`,
  `PUT /inventory/suppliers/:id/opening-balance`, `POST /inventory/suppliers/:id/payments|adjustments`,
  `GET /inventory/suppliers/:id/statement[/export]`, `POST /inventory/payments/:id/void`
- `GET|PUT /inventory/settings`, `GET /inventory/reports?from&to&branchId`

Receiving, taking out, adjusting, applying a count, payments and adjustments need an
`Idempotency-Key`. Access (ADR-0101): `inventory:read`, `inventory:write` (take out, receive,
attach, report a wrong count), `inventory:manage` (items, categories, suppliers' details,
adjustments, counts, reversals, ordered, edit and void receipts), `inventory:money_read` (costs,
values, totals, accounts, attachments), `inventory:money_manage` (prices, one-off purchases, the
account's entries).

## Rules worth knowing

- **Stock** (ADR-0095): movements over batches; a take-out locks the item's batches, leaves the one
  that expires first, and is refused beyond what is there. A batch past its expiry warns.
- **Undo / reverse** (ADR-0096): its author the same clinic day; later `inventory:manage` with a reason.
- **Valuation** (ADR-0097): each batch at `amount / quantity`; costs computed when read, so late
  pricing reaches consumption already recorded.
- **Receipts** (ADR-0098): stock on hand at once, priced or not; _To price_ is not owed; total =
  lines − discount + charges; the same supplier and invoice number warns; a line's quantity never
  goes below what left it; voiding needs every batch untouched.
- **Counts** (ADR-0099): `counted − system_then` applied to the stock as it is; the first count of
  an item in a branch is its opening stock.
- **Labels** (`stockLabels` in contracts): _Out_ · _Expired_ · _Low_ · _Expiring · date_ ·
  _Ordered · date_ · _To count_; _Ordered_ replaces Low and Out; all on the clinic's today.
- **Attachments** (ADR-0100): the patient files' mechanics, never patient files.
- **Search** (ADR-0102): the header's search shows the branch's stock items (`inventory:read`), filtered
  on the device, with _Take out_ (`inventory:write`) opening the Take out panel over the page.

## Events

- `SupplierPaymentRecorded`, `SupplierPaymentVoided` (consumed by `expenses`; stored by the audit
  subscriber, hidden without `inventory:money_read`).
