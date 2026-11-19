# Inventory — implementation plan

Spec: `docs/superpowers/specs/2026-11-19-inventory-design.md` (I1–I11, D1–D12).

Ground rules:

- Branch `feature/20a-inventory`. Nothing is committed until the owner asks.
- Per task, run the affected tests and that package's typecheck. Task 13 runs everything, then one
  review over the working tree.
- Paths are under `apps/api/src/modules/` (API) or `apps/web/src/features/` (web) unless they start
  with `apps/`, `packages/` or `docs/`.
- New strings go to `apps/web/src/locales/{en,ar,fr}/` in the task that adds them.
- The app is live: migration 0062 only adds; existing API shapes only gain fields.
- No queue, job or new Redis use.
- **Moved into `platform/storage`** (said here before doing it, as the prompt asks): the pure byte
  check `files/domain/content-check.ts` (+ spec) becomes `platform/storage/content-check.ts`;
  `files` imports it from there. `ObjectStorage` itself is already in `platform/storage` and only
  its doc comment changes.

## 1. Contracts and permissions

- `permissions.ts`: the five permissions; `capabilities.ts`: the `inventory` group and the
  implications; `audit.ts`: the `inventory` area and its prefixes; `expenses.ts`: the `supplier`
  source, `allowResemblance`.
- New `inventory.ts`: enums, units, packs helpers, `stockLabels`, `formatGoodsReceiptNumber`,
  every route schema, `INVENTORY_MONEY_EVENTS`.
- `dashboards.ts`: `owes.suppliers`, the stock card, the three attention lines; `imports.ts`: the
  item row.
- `roles/domain/system-roles.ts` and the roles locales.
- Done: contracts specs pass (capabilities, packs, labels).

## 2. Schema and migration 0062

- `inventory/persistence/schema.ts`; `expenses` schema with the `supplier` source.
- `drizzle-kit generate` → `0062_inventory.sql`, then by hand: RLS policies, REVOKEs, the category
  seed for existing clinics, the permissions for system roles and templates. Apply to the dev DB.
- Done: migration runs; the RLS list in `tenant-isolation-services.int-spec.ts` has the tables.

## 3. Domain

- `domain/fefo.ts`, `domain/quantities.ts` (via contracts), `domain/valuation.ts`,
  `domain/count.ts`, `domain/account.ts`, `domain/labels.ts` (contracts), errors.
- Done: unit specs.

## 4. Module: catalog side

- Skeleton, `index.ts`, repositories, `CategoriesService`, `ItemsService` (list save, per-branch
  level, ordered, report count, settings), `SuppliersService` (directory), category seeding and
  the currency lock subscribers. Register in `app.module.ts`.
- Done: the items/categories part of `inventory.int-spec.ts`.

## 5. Module: stock

- `StockService`: receive (idempotent, paid now, one-off), price, edit, void; take out (FEFO,
  lock, warnings), undo, reverse; adjust; stock list, item detail, movements, today counts,
  reorder list, export.
- `CountsService`: start, line save, apply, discard, read.
- Done: the stock, count and race parts of `inventory.int-spec.ts`.

## 6. Module: money and attachments

- `SupplierAccountsService`: opening balance, payments, voids, adjustments, accounts, statement +
  export; events `SupplierPaymentRecorded`/`Voided`.
- `ReceiptFilesService` with the moved content check.
- Done: the money and attachment parts of `inventory.int-spec.ts`.

## 7. Reports, dashboards, imports

- `InventoryReportsService`; dashboards' owes, stock card, attention; `POST
/imports/inventory-items`.
- Done: report, dashboard and import cases in `inventory.int-spec.ts`.

## 8. Expenses and audit

- `SupplierPaymentMirrorSubscriber`, the `supplier` source in visibility and the dashboard and
  export labels, the resemblance warning (`expenses/domain/resemblance.ts` + spec).
- `audit`: `withoutInventoryMoney`.
- Done: the mirror, void, resemblance and audit cases.

## 9. Web: API client, words, label, quantity input, Stock tab

- `features/inventory/`: `inventory-api.ts`, `inventory-words.ts`, `stock-label.tsx`,
  `quantity-input.tsx`, `inventory-page.tsx` (tabs), `stock-tab.tsx` (list, take out + undo, item
  panel, reorder list, expiry window), `items-editor.tsx` (Edit items mode), `categories-panel.tsx`;
  route `routes/_app/inventory.tsx`; nav.
- Done: specs for the quantity input and the label.

## 10. Web: receipts, counts, suppliers, reports

- `receipt-page.tsx` (`/inventory/receipts/new|:id`: receive, price, edit, void, attachments),
  `receipts-tab.tsx`; `counts-tab.tsx`, `count-page.tsx`; `suppliers-tab.tsx`,
  `supplier-page.tsx` (+ money panels); `reports-tab.tsx`, `movements-panel.tsx`.
- Done: spec for the receive form's price gating.

## 11. Web: Today, Expenses, Dashboards, Activity

- Today's Stock card; Expenses' source label, the hint and the resemblance confirm; the
  dashboards' Suppliers line, Stock card and attention lines; Activity sentences and the area.
- Done: sentence spec cases.

## 12. Docs

- ADR-0094 to ADR-0101; `docs/modules/inventory.md`; `expenses.md`, `imports.md`,
  `dashboards.md`, `audit.md`, `roles.md`, `files.md`; the `CLAUDE.md` module map.

## 13. e2e, full checks, review

- `apps/web/e2e/inventory.spec.ts`: the end-to-end flow.
- Format, lint, typecheck, unit, integration and Playwright (`--workers=3`); one review.
