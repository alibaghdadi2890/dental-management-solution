# ADR-0102: The search is the app's, and its rows carry actions

- Status: Accepted
- Date: 2026-11-19

## Context

The header's ⌘K finder lived in `features/patients` and found patients and contacts. The owner
wants it to find stock items too, with _Take out_ beside each. Later, patients get their next
appointment, balance, _Schedule_ and _Record payment_. Tapping a row must still open the record,
and each person sees only what they may.

## Decision

1. The search belongs to the shell (`shell/search/`). Each feature supplies its group, as rows
   and their actions: `patients` its patients and contacts (`usePatientSearch`, the row
   contents), `inventory` its stock (`useStockSearch`, `StockResult`). Features don't import
   each other for it.
2. A group shows only with its permission: patients and contacts need `patient:read`, stock items
   `inventory:read` (the user's branch). The search is offered when any group is. Its name
   follows what it finds: _Find patient_ for patients only, _Search_ for both, _Search stock_ for
   stock only.
3. The results are an ARIA grid behind the combobox (`aria-haspopup="grid"`), not a listbox,
   because an option can't hold buttons. Each result is a `row`. Its first cell opens the record
   and each action is a further cell. Focus stays in the input, and `aria-activedescendant` names
   the active cell. ↑/↓ change the row, and → (from the end of the text) and ← change the cell.
   Enter does what the active cell does. Pointers press the buttons, which show on the active or
   hovered row and always on touch screens.
4. An action that opens a panel does it over the page the user is on. The panel is mounted once
   by the shell: _Take out_ uses `TakeOutProvider`, as the contact and payment panels have theirs.

## Consequences

- Tests and e2e read the results as `row`s, the groups as `rowgroup`s.
- A new group is a hook and a row component in its feature, plus one entry in the shell's list.
