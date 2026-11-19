# Search — design

Written 2026-11-19 with the owner. The ⌘K patient finder becomes the app's search. Each group of
results shows only for whoever has its permission, and a row can carry quick actions beside it;
tapping the row itself still opens the record. Step 1 adds stock items with _Take out_. Step 2
adds patients' next appointment and balance, with _Record payment_ and _Schedule_.

## Problem

The header's search finds patients only, and a patient row shows nothing the desk acts on.
Someone at the chair who needs to take out a box of gloves must go to Inventory, find the item
and use its menu. The front desk looks up a patient to book or take a payment, then opens the
record to do either.

## Decisions

- **S1. One search for the app, owned by the shell.** The popup moves from `features/patients`
  to `shell/search/`. Patients, contacts and stock items are **groups**; each feature gives the
  shell its group's rows and actions, so no feature imports another's search. The search
  is offered when the user has any group's permission: `patient:read` (patients, contacts) or
  `inventory:read` (stock items). Ctrl/⌘+K works as before.
- **S2. The name follows what it searches.** With patients only, the header button, the dialog
  and the input keep their words (_Find patient_). With stock items too they say _Search_, and
  the placeholder names both (_Patients or stock items_). With stock only: _Search stock_.
- **S3. Rows with actions are a grid (ADR-0102).** A row can't hold buttons inside a list option,
  so the results become an ARIA grid, the combobox popup that allows actions. Each row is one
  `row`: its first cell opens the record, and each further cell is one action button. Focus
  stays in the input, and `aria-activedescendant` names the active cell.
  - ↑/↓ move between rows and land on the first cell. → moves to the row's next action when the
    caret is at the end of the text; ← moves back and, from the first cell, gives the caret back.
    Enter does what the active cell does.
  - The mouse and touch press a button directly. An action button shows on the active or hovered
    row, and is always shown on touch screens.
  - The popup widens from 540 to 720px, still within the screen's margins.
- **S4. Group order and size.** Patients first (5 recent with no query; 8 found), then contacts
  (3), then stock items (3, only while searching). Each group has its heading. _Create "…"_ still
  appears only when nothing at all matches.

### Step 1 — stock items

- **S5. Found on the device.** The stock of the user's branch (`session.branch`, else the first)
  is the Stock tab's own query, `GET /inventory/stock?branchId=`. A clinic has hundreds of items,
  so it loads once when the search opens and is filtered as the user types, with the Stock tab's
  `matchesItem` (name or code, case and accents aside). Inactive items are left out. A failed load
  only hides the group.
- **S6. What a row shows:** the name and code; what is on hand, in packs and units, as the Stock
  tab writes it; and the one label (Out, Low, Expired…). The group heading says _Stock_, with the
  branch's name for a clinic with several.
- **S7. Tapping the row** opens the item on the Stock tab (`/inventory?branch=…&item=…`).
- **S8. _Take out_** (`inventory:write`, an active item with stock) closes the search and opens
  the Take out panel over the page the user is on, with the item chosen and _1_ of its pack, or of
  its unit when it has no pack. The quantity field has focus, so Enter takes out one box and any
  other amount is typed. The panel is mounted once by the shell (`TakeOutProvider`), like the
  contact panel, and its toast for a single item offers _Undo_, like the Stock tab's quick take-out.

### Step 2 — patients

- **S9. Two lookups for the rows found.** Neither belongs to `patients`, so the rows load first
  and two batched reads fill them in a moment later:
  - `GET /scheduling/patients/upcoming?patientIds=` (`appointment:read`): each patient's next
    booked or confirmed appointment from now, with its start and dentist.
  - The balances. With `finance:read`, the existing `GET /billing/balances?patientIds=` gives
    the amount. With only `payment:read`, a new `GET /billing/balance-states?patientIds=` gives
    the state, _Owes_ or _In credit_, and no amount: ADR-0055 keeps balances in lists to
    `finance:read`.
  - Without either permission the column is not there. A failed lookup leaves it empty, and
    typing never waits for it.
- **S10. The row:** the name, number, phone and age as today; at its end, where _Never seen_
  stood, the next appointment (_Next 21 Nov 2026, 10:30_) and the balance (_Owes $40_, _Credit
  $20_, or _Owes_ / _In credit_ without the amount). A patient with nothing ahead, or settled,
  shows nothing there; so does one whose lookup is not allowed.
- **S11. Actions:** _Schedule_ (`appointment:write`) opens the booking panel on the Schedule with
  the patient chosen. _Record payment_ (`payment:write`) opens the shell's payment panel for the
  patient, over the page.

## Not in scope

Suppliers, labs, lab orders and visits as groups; a full results page (_Show all_); recent stock
items with no query.

## Tests

- **Unit:** the existing palette tests move to `shell/search/` and read rows instead of options.
  Further cases: items match by name and code; the groups follow permissions; Take out opens the
  panel with the item and one pack; → and Enter run the action; the stock-only search.
- **API (step 2):** next appointments and balance states, with their permissions and tenant
  isolation.
- **E2E:** the patients spec reads rows. The inventory spec takes out from the search and undoes
  it.
