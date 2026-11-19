# Inventory — design

Feature 20a. Written 2026-11-19 from the feature prompt (business requirements, decisions I1–I11
taken with the owner). Everything marked **(my call)** is proposed and open to the owner; the
layout questions are at the end. Run b (reading a supplier's invoice with AI) is not built; this
run keeps its door open (D12).

## Problem

The clinic buys supplies from suppliers, uses them chair-side and loses track of what is on the
shelf, what is about to expire and what it owes. The owner wants the number on the screen to be
the number on the shelf, every change to it to have an author and a reason, and supply money to
be counted once: a receipt is what the clinic owes a supplier; only a payment is an expense.

## Decisions from the prompt (not reopened)

- **I1.** Usage is recorded by taking stock out; nothing is deducted from a visit's services.
- **I2.** Stock is kept per branch. A clinic with one branch never sees a branch choice.
- **I3.** Nothing changes by itself: expired stock stays until written off, low stays low until
  received.
- **I4.** Whoever receives need not see prices; a receipt is priced later.
- **I5.** Payments go to a supplier's account, never to single receipts; each one is a read-only
  row in Expenses under _Dental supplies & materials_.
- **I6.** That category stays open by hand; a manual expense resembling a supplier payment warns.
- **I7.** Any assistant may take stock out.
- **I8.** Costs and balances are hidden from those who only work with stock.
- **I9.** Quantities are whole numbers of the item's unit.
- **I10.** Clinic currency only.
- **I11.** Today shows exceptions only, as counts.

## Design decisions

- **D1. A new module, `inventory` (ADR-0094).** It owns categories, items, per-branch item
  state, suppliers, receipts, batches, movements, counts, supplier payments and adjustments,
  receipt attachments and its settings. It depends on `tenancy` (currency, time zone, branches,
  locale), `users` (names) and `audit` only. `expenses` imports its payment events (as for labs);
  `imports` and `dashboards` gain an edge to it. It consumes `TenantProvisioned` (the categories,
  ADR-0014) and `TenantCurrencyChanged` (the lock). Nothing else imports it.
- **D2. Stock is movements over batches (ADR-0095).** A **batch** is one received line, one
  opening stock entry, or (rarely) a count surplus with no batch to join. A **movement** is one
  change by a person to one item in one branch: `receive`, `opening`, `take_out`, `adjust`
  (with a reason), `count`, `receipt_edit`, `receipt_void`, `reversal`. A movement says which
  batches it changed and by how much (`inventory_movement_batches`). A batch's `quantity_left` is
  the sum of its movement lines: it is a projection written only in the same transaction as the
  movement, under a lock on the item's batches in that branch, and a CHECK keeps it ≥ 0. On hand =
  Σ `quantity_left` of the item's batches in the branch. A quantity is never typed over.
  - **Which batch** (`domain/fefo.ts`): the batch that expires first (no expiry last), then the
    oldest received, then the oldest created. The user may name another batch.
  - **Two people, the last box:** both lock the same batch rows (`FOR UPDATE`, in id order); the
    second sees the first's result and is refused with what is left.
- **D3. Usage by take-out; undo and reversal (ADR-0096).** A take-out is one or several items;
  each item is a `take_out` movement. Its author may **undo** it the same clinic day; later
  someone with _Manage inventory_ **reverses** it with a reason. Either way a `reversal` movement
  puts the units back into the batches the take-out left, and the take-out is marked reversed
  (once). Only take-outs are reversed **(my call)**: a wrong adjustment is corrected by a
  _Correction_.
- **D4. Valuation at cost, late pricing (ADR-0097).** A batch's cost is what its line cost
  (`amount`, money) for its `quantity` received; its unit cost is `amount / quantity`, exact, never
  stored rounded. Stock value = Σ `quantity_left × amount / quantity` over priced batches, rounded
  to cents once per total. A movement's cost is `−Σ line quantity × amount / quantity` of the
  batches it touched, computed when read, so a batch priced later costs everything it already
  gave out. An unpriced batch counts for quantity and not for value; every value carries
  `unpriced` (receipts to price, opening batches without a cost) beside it. Discount and tax and
  other charges change what is owed, never what stock is worth.
- **D5. A receipt is owed; a payment is mirrored (ADR-0098).** A priced receipt of a registered
  supplier is owed from its date received, at its total (lines − discount + charges). A receipt
  with any unpriced line is _To price_ and is not owed yet. Only a **supplier payment** is an
  expense: `SupplierPaymentRecorded` / `SupplierPaymentVoided` are published in the payment's
  transaction and `expenses` writes or voids a read-only row (new source `supplier`, category
  `supplies`, payee = the supplier's name or the one-off payee) in the same transaction, like the
  lab mirror. A **one-off purchase** is a receipt without a supplier: priced and paid when
  recorded, its payment is a supplier payment with no supplier (no account), so it is mirrored the
  same way and voided with the receipt.
- **D6. The count while work continues (ADR-0099).** Each count line stores, when it is saved,
  the counted quantity and the system's quantity at that moment. Applying turns each counted line
  into a `count` movement of `counted − system then`, applied to the stock as it is now: a
  shortage leaves the batches that expire first (never below zero: what is not there is not
  taken), a surplus joins the newest batch; an item with no batch ever in that branch gets an
  opening batch (the first count is how opening stock is entered, with an optional cost, lot and
  expiry on the line). Movements recorded meanwhile are therefore neither lost nor counted twice.
- **D7. Receipt attachments (ADR-0100).** Up to five photos or PDFs per receipt, stored by
  `inventory` in object storage with the mechanics patient files use (ADR-0039, ADR-0041):
  presigned `PUT` to an `uploads/` key, a _seal_ that copies inside the store and checks the copy
  (size ≤ 25 MB, the first bytes match the type), presigned `GET` to read; outside the
  transaction, deletes best effort. Keys `tenants/<t>/inventory/receipts/<receiptId>/<fileId>`
  and `tenants/<t>/inventory/uploads/<fileId>`. The byte check (`contentMatches`) moves from
  `files/domain/content-check.ts` to `platform/storage/content-check.ts` (pure, no patient
  knowledge) and both modules import it; nothing else moves. No previews: an image or a PDF opens
  in a new tab. Never patient files.
- **D8. Permissions (ADR-0101).** `inventory:read` (_See stock_), `inventory:write` (_Take out
  and receive_), `inventory:manage` (_Manage inventory_), `inventory:money_read` (_See inventory
  money_), `inventory:money_manage` (_Manage inventory money_); group `inventory`. Implications:
  `write ⇒ read`, `manage ⇒ write`, `money_read ⇒ read`, `money_manage ⇒ money_read`. Owner and
  admin hold all five; assistant read, write, manage; dentist and front desk read, write. A
  platform admin holds them like any non-payroll permission. Without `inventory:money_read` every
  response carries `null` for costs, values, totals and balances, attachments can't be opened, and
  the money routes answer 403. Migration 0062 only adds.
- **D9. One label (contracts `stockLabels`).** Computed by the API for each item and branch and
  returned with it; one SPA component draws it (most urgent + `+n`). In order: `out`, `expired`,
  `low`, `expiring` (with the earliest date), `ordered` (with its date), `to_count`. `ordered`
  replaces `low`/`out`. Dates in the clinic time zone. The expiring window is an inventory
  setting (`inventory_settings.expiring_days`, default 60, 1–365) **(my call: owned by
  `inventory`, edited from the Stock tab's menu with _Manage inventory_)**.
- **D10. Numbers.** Receipts are `GR-000123` (goods received; `RCT-` is the patient receipt) from
  `inventory_receipt_counters`, never reused.
- **D11. Quantities.** The API takes and returns units (integers). Contracts helpers convert packs
  (`toUnits`) and describe a quantity in both (`splitPacks`: 7 boxes + 20 pieces). Units and pack
  names are a key from a short list (translated) or the clinic's own word.
- **D12. Run b's door.** `ReceiptsService.receive(input)` takes the whole receipt as one
  `receiveSchema` object and returns plain data; the Receive screen opens pre-filled from such an
  object (`?draft=` holds it in the route state). No draft status, no AI library.

## Data (migration 0062, additive)

Every table is a tenant table (`tenantColumns`, RLS, `tenant_id` index, `created_at`,
`updated_at`). Money `numeric(12,2)` + `currency`. Branch ids have no foreign key (`tenancy`).

| Table                            | Columns (beyond the standard)                                                                                                                                                                                                     | Notes                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `inventory_categories`           | `key` (predefined) or `name`, `active`, `created_by`                                                                                                                                                                              | as `expense_categories`; seeded for every clinic                       |
| `inventory_items`                | `name`, `code`, `category_id`, `unit`, `pack_name`, `pack_size` (2–10000), `reorder_level`, `usual_supplier_id`, `usual_order_packs`, `tracks_expiry`, `note`, `active`, `created_by`                                             | unique `lower(name)`, unique `lower(code)` where set; no DELETE        |
| `inventory_item_branches`        | `item_id`, `branch_id`, `reorder_level` (null = the item's), `ordered_on`, `ordered_note`, `ordered_by`, `to_count_at`, `to_count_by`                                                                                             | unique `(item_id, branch_id)`, created on first need                   |
| `inventory_suppliers`            | `name`, `contact_person`, `phone`, `email`, `address`, `note`, `active`, `opening_balance`, `opening_balance_on`, `currency`, `created_by`                                                                                        | unique `lower(name)`; no DELETE                                        |
| `inventory_receipt_counters`     | `tenant_id` pk, `last_value`                                                                                                                                                                                                      |                                                                        |
| `inventory_receipts`             | `display_number`, `supplier_id` null, `payee` (one-off), `branch_id`, `received_on`, `invoice_number`, `invoice_date`, `discount`, `charges`, `currency`, `note`, `created_by`, void columns, idempotency key + hash              | exactly one of supplier / payee; no DELETE                             |
| `inventory_batches`              | `item_id`, `branch_id`, `source` (`receipt`/`opening`/`count`), `receipt_id`, `position`, `lot`, `expires_on`, `received_on`, `quantity`, `quantity_left` ≥ 0, `price`, `price_per` (`pack`/`unit`), `amount`, `currency`         | a receipt's lines are its batches; index `(item, branch)`; no DELETE   |
| `inventory_movements`            | `action_id`, `kind`, `item_id`, `branch_id`, `quantity` (signed), `reason`, `note`, `occurred_on`, `receipt_id`, `count_id`, `reverses_id`, `reversed_at`, `reversed_by`, `reversal_reason`, `created_by`, idempotency key + hash | index `(branch, item, occurred_on)`; UPDATE only the reversal columns  |
| `inventory_movement_batches`     | `movement_id`, `batch_id`, `quantity` (signed)                                                                                                                                                                                    | append-only                                                            |
| `inventory_counts`               | `branch_id`, `category_ids` uuid[] (empty = all), `status` (`open`/`applied`/`discarded`), `started_by`, `applied_at`, `applied_by`, `discarded_at`, `discarded_by`, apply idempotency key                                        | one open count per branch (partial unique)                             |
| `inventory_count_lines`          | `count_id`, `item_id`, `counted`, `system_then`, `counted_by`, `counted_at`, `opening_amount`, `opening_price_per`, `opening_price`, `opening_lot`, `opening_expires_on`, `difference` (set on apply)                             | unique `(count_id, item_id)`                                           |
| `inventory_supplier_payments`    | `supplier_id` null, `receipt_id` null, `payee`, `paid_on`, `amount` > 0, `currency`, `method`, `reference`, `note`, `created_by`, void columns, idempotency key + hash                                                            | a one-off's payment has `receipt_id` and no supplier; UPDATE only void |
| `inventory_supplier_adjustments` | `supplier_id`, `on_date`, `kind` (`credit`/`charge`), `amount` > 0, `reason`, `created_by`, idempotency key + hash                                                                                                                | append-only                                                            |
| `inventory_receipt_files`        | `receipt_id`, `filename`, `mime_type`, `size_bytes`, `storage_key`, `uploaded_by`, `saved_at` (null = pending)                                                                                                                    | a pending row is invisible                                             |
| `inventory_settings`             | `tenant_id` pk, `expiring_days`                                                                                                                                                                                                   |                                                                        |

The migration seeds the twelve categories for every existing clinic, adds `supplier` to the
`expenses` source CHECK and mirror index, and adds the five permissions to every clinic's system
roles and to the templates as D8 says (`ON CONFLICT DO NOTHING`).

## Rules

### Categories and items (`inventory:manage` to write; reads `inventory:read`)

- Categories: the twelve predefined keys (translated), deactivate/reactivate only; custom ones
  are named (1–60, unique case-insensitively against the others and every translation), renamed,
  deactivated, and deleted while unused (the expense rules).
- **Items** are saved as a list (`PUT /inventory/items`, the Catalog's save): each row created or
  updated in one transaction; per-row errors carry the row's index. Name 1–120 unique
  (`inventory.item_name_taken`), code ≤ 40 unique when given. Unit 1–30, pack name ≤ 30 with a
  pack size 1–10000 (both or neither), reorder level 0–1,000,000, usual order packs 1–10,000,
  note ≤ 500.
- **Locked once moved:** an item with any movement keeps its unit and pack size
  (`inventory.item_unit_locked`).
- **Inactive** only when no branch holds any of it (`inventory.item_in_stock`); refused for
  receiving and taking out (`inventory.item_inactive`). Never deleted.
- Per branch: reorder level override (`PUT /inventory/items/:id/branches/:branchId`).

### Receiving (`inventory:write`; any price, discount, charges or _Paid now_ needs `inventory:money_manage`)

- `POST /inventory/receipts` (`Idempotency-Key`), `receiveSchema`: `supplierId` or `payee`
  (one-off), `branchId`, `receivedOn` ≤ today, `invoiceNumber`, `invoiceDate`, `note`, `lines`
  (1–100: `itemId` active, `quantity` units 1–1,000,000, `price` ≥ 0 + `pricePer`, `lot` ≤ 40,
  `expiresOn` required when the item tracks expiry), `discount`, `charges`, `paidNow` (`{ paidOn,
method, reference }`), `allowDuplicateInvoice`.
- Saving puts the stock on hand: one batch and one `receive` movement per line, and clears
  _Ordered_ for those items in that branch.
- The same supplier and invoice number (trimmed, case-insensitive) on a live receipt → 409
  `inventory.duplicate_invoice` with the earlier receipt, unless `allowDuplicateInvoice`.
- A **one-off purchase** needs `inventory:money_manage`, every line priced and `paidNow`
  (422 `inventory.one_off_unpaid`); its payment is recorded in the same transaction.
- `paidNow` on a registered supplier needs every line priced; it records a payment of the total.
- **Price** `PUT /inventory/receipts/:id/prices` (`inventory:money_manage`): line prices, discount,
  charges. Audited before/after.
- **Edit** `PATCH /inventory/receipts/:id` (`inventory:manage`): date, invoice number and date,
  note, per line lot, expiry and quantity (≥ what has left it: `quantity − quantity_left`, and
  ≥ 1; a `receipt_edit` movement for the difference), added lines (with prices only with money).
  Not on a voided receipt.
- **Void** `POST /inventory/receipts/:id/void { reason }` (`inventory:manage`; a one-off also
  `inventory:money_manage`): refused unless every batch still holds exactly its quantity
  (`inventory.receipt_touched`). A `receipt_void` movement empties its batches; the receipt is no
  longer owed; a one-off's payment is voided with it. Payments to an account stay.
- **Attachments** (`inventory:write`): `POST /inventory/receipts/:id/files/uploads` (≤ 5 saved
  per receipt, JPEG, PNG, WebP, HEIC/HEIF or PDF, ≤ 25 MB) → upload URLs; `POST
/inventory/receipts/:id/files { ids }` seals them; `GET /inventory/receipts/:id/files/:fileId`
  (`inventory:money_read`) → a 5-minute URL; `DELETE …/:fileId` (`inventory:money_manage`).

### Taking out (`inventory:write`)

- `POST /inventory/take-outs` (`Idempotency-Key`) `{ branchId, items: [{ itemId, quantity,
batchId?, note? }] (1–50, each item once), allowExpired }`. Each item: FEFO unless `batchId`;
  more than on hand → 409 `inventory.not_enough_stock` with `{ itemId, onHand }`, nothing taken;
  a batch past its expiry → 409 `inventory.expired_batch` unless `allowExpired`.
- `POST /inventory/movements/:id/undo` (its author, the same clinic day, a take-out not
  reversed) and `POST /inventory/movements/:id/reverse { reason }` (`inventory:manage`).
- `POST /inventory/items/:id/report-count { branchId }`: _To count_ (cleared by applying a count
  that counted the item).

### Adjusting (`inventory:manage`)

`POST /inventory/adjustments` (`Idempotency-Key`) `{ branchId, itemId, batchId, reason, quantity
(signed, ≠ 0), note }`: only `correction` may add; `correction` needs a note; never below zero.

### Counting (`inventory:manage`)

- `POST /inventory/counts { branchId, categoryIds }`: one open count per branch (409
  `inventory.count_open`); a line per active item in scope.
- `PUT /inventory/counts/:id/lines/:itemId { counted | null, opening? }`: saves as the user
  goes, stamping `system_then` = on hand now. `opening` (cost only with money) is accepted for an
  item that never had a batch in that branch.
- `GET /inventory/counts/:id`: the lines with the live and stamped system quantity and, once
  counted, the difference (and its value with money).
- `POST /inventory/counts/:id/apply` (`Idempotency-Key`): D6; clears _To count_ for counted
  items. `POST /inventory/counts/:id/discard`.

### Labels, ordered, reorder list

- `PUT /inventory/items/:id/branches/:branchId/ordered { orderedOn ≤ today, note } | DELETE`
  (`inventory:manage`), and `POST /inventory/reorder/ordered { branchId, itemIds, orderedOn,
note }` (per supplier from the list).
- `GET /inventory/reorder?branchId` (`inventory:read`): low and out items not ordered, grouped by
  usual supplier, each with the usual order packs. No prices.

### Suppliers and their money

- Directory (`inventory:read`), details (`inventory:manage`): name 1–80 unique, contact, phone,
  email, address, note, active. Never deleted.
- Account (`inventory:money_read`): `owed = opening + Σ priced live receipts' totals + Σ charges
− Σ credits`, `outstanding = owed − Σ live payments`; `toPrice` receipts apart (count only).
- `PUT …/opening-balance { amount, asOf }`, `POST …/payments` and `POST …/adjustments`
  (`Idempotency-Key`), `POST /inventory/payments/:id/void { reason }` (`inventory:money_manage`).
  A payment's date ≤ today, method from the clinic's methods.
- Statement `GET /inventory/suppliers/:id/statement?from&to` + CSV export: balance before, lines
  (opening balance, receipts, payments with voided flagged, adjustments) with a running balance.
- **Currency lock:** refused once any priced batch, opening balance, payment or adjustment exists.

### Expenses (`expenses` module)

- Source `supplier` (label _Suppliers_), visible to `expense:read`, counted in totals and Today's
  card, refused for edit and void from Expenses.
- **Resemblance:** a manual expense recorded or edited into `supplies` is refused with 409
  `expense.resembles_supplier_payment` (the matching rows in the problem) when a live `supplier`
  row has the same payee (case and spaces ignored) or the same amount within ±3 days, unless
  `allowResemblance`. Answered from `expenses`' own rows.

### Reports (`inventory:read`; costs with `inventory:money_read`)

`GET /inventory/reports?from&to&branchId` (branch optional = all): consumption by item and by
category (take-outs net of their reversals), adjustments by reason (write-offs, corrections and
count differences), purchases by supplier (money only; priced receipts by date received, one-off
purchases by payee), stock value now by category (money only), and `unpriced`. Every figure opens
`GET /inventory/movements?…` (the item history uses the same route).

### Today and dashboards

- `GET /inventory/today?branchId` (`inventory:read`): `{ out, expired, low, expiring, toCount,
toPrice (money_manage only, else null) }`.
- Financial: `owes.suppliers` (money_read); `GET /dashboards/financial/stock` — value now,
  consumption in the period, top 8 items by cost + _Other_, `unpriced` — needs
  `inventory:money_read`; steps aside with a dentist filter.
- Operational attention: `stockOut`, `stockLow`, `stockExpired` (`inventory:read`), null with a
  dentist filter.

### Import (`imports`)

`POST /imports/inventory-items { dryRun, rows }` (`import:run`, and the inventory permissions the
service re-checks): `code?`, `name`, `category` (a translation of a key or a custom name, created
when new), `unit`, `packName?`, `packSize?`, `reorderLevel?`, `tracksExpiry`, `usualSupplier?`
(a name), `usualOrderPacks?`, `note?`, `opening?` `{ branchId?, quantity, unitCost?, lot?,
expiresOn? }[]`. Matched by code, else by name, else created; opening stock is skipped for a
branch where the item already has a batch (so a second run adds nothing).

## Audit

Area **`inventory`**; resource types `inventory_category`, `inventory_item`, `inventory_supplier`,
`inventory_receipt`, `inventory_movement`, `inventory_count`, `inventory_payment`,
`inventory_adjustment`, `inventory_settings`. Actions: `inventory_item.create | update |
ordered | unordered | report_count | branch_level | opening_cost`, `inventory_category.create |
rename | deactivate | reactivate | delete`, `inventory_receipt.receive | price | edit | void |
attach | detach`, `inventory_movement.take_out | undo | reverse | adjust | opening`,
`inventory_count.start | apply | discard`, `inventory_supplier.create | update |
opening_balance`, `inventory_payment.record | void`, `inventory_adjustment.record`,
`inventory_settings.update`. Without `inventory:money_read` the feed hides `inventory_payment`,
`inventory_adjustment`, `inventory_receipt.price`, `inventory_supplier.opening_balance`,
`inventory_item.opening_cost` and the stored payment events; no other snapshot holds a price.
An opening batch entered without a cost is priced later with `PUT /inventory/batches/:id/price`
(`inventory:money_manage`).

## Screens (web)

- **Nav:** **Inventory** (`/inventory`, `inventory:read`) after Lab, tabs _Stock · Receipts ·
  Counts · Suppliers · Reports_; tab, branch and filters in the URL.
- **Stock:** branch switch (several branches only), search (name or code, instant), filters
  (category, status, supplier, inactive), rows: name, category, on hand (both units), label,
  value (money); _Take out_ (one pack/unit + _Undo_ toast; ⋯ for the longer form), _Receive_.
  Menu: _Reorder list_, _Edit items_, _Categories_, _Expiry window_, export. An item opens a side
  panel: batches, quantity per branch, history, settings (reorder level here, ordered, report
  count).
- **Receipts:** list with filters; a receipt opens with its lines, attachments, actions (price,
  edit, void). _Receive_ and _One-off purchase_.
- **Counts:** open count first, then past counts with their differences; the sheet saves each
  line on blur, prints blank, _Apply_ shows the differences first.
- **Suppliers:** directory; with money the outstanding and the total; a supplier opens with its
  statement, figures and actions.
- **Reports:** period, branch, the four sections; a figure opens its movements.
- **Today:** a _Stock_ card (only when something shows).
- **Expenses:** source label _Suppliers_; the _Dental supplies & materials_ **!**; the
  resemblance warning with _Save anyway_.
- **Dashboards:** _Suppliers_ in _What the clinic owes_; the _Stock_ card; three _Needs
  attention_ lines.
- **Activity:** the `inventory` area and its sentences.
- **Quantity input:** one component, packs or units, both shown.

## Tests

- **Domain:** packs and units; FEFO; labels around midnight in Asia/Beirut; count differences with
  movements in between; valuation with unpriced batches and late pricing; the account arithmetic;
  the resemblance rule (in `expenses/domain`).
- **Integration** (`inventory.int-spec.ts`): the acceptance in USD / Asia/Beirut; the expense
  mirror and its void; the resemblance warning; idempotency; the last-box race; the currency lock;
  permissions; the import (dry run, run, rerun).
- **Tenant isolation:** the new tables in the RLS list; the new routes in
  `tenant-isolation-services.int-spec.ts`.
- **Web specs** where there is logic: the quantity input, the label, the take-out flow, the
  receive form's price gating.
- **e2e** (`inventory.spec.ts`): add an item → receive without prices → price → pay → the expense
  → take out → low on Today → mark ordered → count → apply.

## Out of scope

The prompt's list, plus: reversing an adjustment or a count (corrected by a _Correction_); a
movement's date is the day it is recorded (no back-dating); attachments have no preview.

## Layout agreed with the owner (2026-11-19)

The four questions were answered as proposed:

1. **Edit items** is a mode of the Stock tab (its menu): the list becomes the Catalog's inline grid
   with the save bar; _Categories_ open from the same menu in a right panel.
2. **Receive** and a receipt are their own page (`/inventory/receipts/new`,
   `/inventory/receipts/:id`); the same page prices and edits.
3. **A count sheet** is its own page (`/inventory/counts/:id`); _Apply_ shows the differences in a
   dialog first.
4. **A supplier** opens on its own page (`/inventory/suppliers/:id`) like a lab: Statement and
   Receipts tabs, a Details card, figures, and right-panel forms.

The calls marked **(my call)** stand until the owner says otherwise.
