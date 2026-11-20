# Today board refresh — design

Date: 2026-11-20. Web only (`apps/web`); no API or contract change. Supersedes the layout of
`2026-10-04-today-board-design.md`; every card keeps its data, rows and actions.

## Decisions

- **T1. Bands by urgency, packed in thirds.** Three bands, each packing its cards in order:
  - _Now_: Waiting (⅓), In the chair (⅓), Next up (⅓), Ready for checkout (⅔).
  - _Today_: Schedule timeline (⅔), Follow-ups (⅓), Openings to fill (⅓), Coming up (⅓).
  - _Back office_: Lab work (⅔), Stock (⅓), Expenses (⅓).
  - Packing (`components/board/board-layout.ts`, `packBoard`, pure): each card, in order, takes
    the highest place its width fits (the leftmost of equals), so a short card slips under a short
    neighbour; then each card widens over a column beside it that holds nothing over its height,
    so a band never ends on an empty strip (a lone card takes the whole row). Heights are measured
    whenever a card comes, goes or changes size, and the cards are placed before the screen paints.
  - The band is three columns from 880px of its own width, two from 560px (⅔ and ⅓ cards keep
    their order, ⅔ takes both), one below. A band whose grid holds no card is hidden with its label.
- **T2. No empty cards.** A card without rows is not rendered: In the chair, Ready for checkout,
  Lab work lose their empty notes; Expenses goes when the month has no expense and nothing waits.
  A card that failed to load still shows its failure note. When every permitted card is absent
  after the first load, one line says nothing needs attention, with links to Schedule and Patients.
- **T3. Card frame** (`TodayCard`): one hue; a header with the hue's wash fading to white, a solid
  icon badge, the title (a link to its screen when it has one), a count pill, at most one quick
  action, and a collapse toggle. Collapsed cards show only the header (count still visible);
  collapsed ids are kept per user in `localStorage` (`dcm.today.collapsed.<userId>`). Long cards
  show their first rows (Waiting, Coming up, Follow-ups, Lab work: 5; Checkout: all) and _Show
  all n_. Hover lifts the card 2px with a soft shadow.
- **T4. Hues.** Eight sets of variables in `components/board/board.css`, per `data-hue`
  (`--hue`, `--hue-ink`, `--hue-tint`, `--hue-border`; every badge colour carries white text at
  4.5:1): indigo (In the chair, Next up, Schedule, Coming up — the app's primary), amber
  (Waiting), rose (Checkout), violet (Follow-ups), sky (Openings), teal (Lab work — the existing
  lab tokens), green (Stock), orange (Expenses — the chart expenses colour). Used only on Today
  cards.
- **T5. Quick actions.** Schedule _+ Appointment_ (`appointment:write`, the calendar's booking
  panel), Stock _Receive_ (`inventory:write`, the new receipt screen), Expenses _+ Expense_
  (`expense:manage`, the existing Record expense panel, opened on Today). Each only with its
  permission. Lab work has none: an order is made from a visit or a patient record; Take out needs
  an item and stays the search's.
- **T6. Live tickers.** One shared clock (`useNow`, 15 s). Waiting minutes count up and turn
  warning at 10 min, danger at 20 min (constants, the same for every clinic). Next up counts down
  ("in 12 min", then "now"). Chair timers as today. The timeline's now-line follows the clock.
- **T7. Schedule timeline.** A read-only horizontal strip (`features/scheduling/today-timeline.tsx`)
  replacing the dentist/time-chip rows: one lane per dentist with appointments today, a span from
  the first start to the last end, floored/ceiled to whole local hours, stretched to take in now
  when now is within two hours of them (otherwise the now-line is off). Overlapping blocks stack. Blocks are placed by start and end, coloured by status (booked dashed, confirmed,
  checked in = warning, in room = primary solid, completed / no-show muted, cancelled struck).
  Hover and focus show time, patient, reason and status; click opens `/schedule?appointment=id`.
  The header keeps the count, unconfirmed and unresolved chips, _View calendar_ is the title link.
  Hand-built under ADR-0108 (read-only overview strips may be drawn by hand; any interactive
  calendar stays react-big-calendar behind `schedule-calendar.tsx`).
- **T8. Freshness.** Visits and schedule keep their 30 s polling and the alerts stream's
  invalidation. Lab work, Stock and Expenses get `refetchInterval: 60_000` and refetch on window
  focus when read by Today (set at the call site; other screens unchanged).
- **T9. Arrival.** Until a card has rendered, a skeleton shows. Cards that render before the
  board's queries have settled (no fetch for 300 ms) appear without animation; then the board is
  _armed_. Afterwards:
  - a card mounting blooms (scale 0.9 → 1 with a slight overshoot, the header wash sweeps in, a
    ring in its hue fades over ~2.5 s);
  - cards glide to their new places (CSS transitions on their placed position, ~380 ms) and bands
    grow and shrink, also when a card leaves or a row is added or removed; a card placed for the
    first time takes its place without gliding;
  - a row mounting in a card already shown slides open with a wash of the hue fading over ~2 s;
  - a count that changes bumps.
  - `prefers-reduced-motion`: no movement, no sweep; the ring only.

## Structure

- `components/board/` (generic, so feature cards import it without a cycle with `features/today`):
  `board.tsx` (`Board`: armed flag, collapse store, skeleton / all-clear; `Band`), `board-kit.ts`
  (context, `useRowArrival`, class constants), `today-card.tsx` (frame, collapse, arrival, count
  bump), `board-layout.ts` (the packing), `board-more.tsx` (_Show all n_), `board-icons.tsx`,
  `observe-has.ts`, `use-now.ts`, `board.css` (hues per `data-hue`, glides, keyframes, reduced
  motion).
- A band hides itself when it holds no card, and the board shows its skeleton (nothing rendered
  yet, not armed) or its all-clear line (armed, no card) from a `MutationObserver` on its own DOM,
  so no card reports to the page whether it is empty.
- Feature cards render inside `TodayCard` and drop their own `Section` frames: `TodaySchedule`
  splits into `TodayScheduleCard`, `NextUpCard`, `WaitingCard`, `ComingUpCard`;
  `FollowUpWorklist`, `TodayOpeningsLane`, `TodayLabLane`, `TodayStockCard`,
  `TodayExpensesCard`; the checkout and chair lanes stay in `features/today/`.
- `TodayPage` composes the three bands and owns arming (all its queries settled once).

## Testing

- Unit: packing (holes filled, widening, fewer columns); timeline geometry (span, block
  placement, now-line, clamping); waiting tone thresholds.
- Today page spec: empty cards absent; an empty band hidden; a card arriving after the first load
  gets the bloom class, the first render does not; collapse remembered.
- Update the existing Today specs and e2e steps that expected the empty notes.
