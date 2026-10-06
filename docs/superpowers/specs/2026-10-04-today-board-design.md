# Today board — the front desk's home — design

Date: 2026-10-04 · Status: Implemented (2026-10-04); see §Implementation notes

## Goal

The checkout handoff (`2026-10-04-checkout-handoff-design.md`) works, but its only signal is a
small header pill and its surface is the completer's "Visit recorded" dialog. This adds a home
screen for whoever collects: today's patient flow, with the visits waiting for checkout as the
main lane and a dedicated Checkout panel.

SPA only. No API, contract or permission change: the lanes read `GET /billing/visits/unpaid`
(the C1 queue) and `GET /visits?tab=in_progress`.

**Out of scope (step 2, needs its own decisions):** a dentist's note for the front desk at
completion, a stored "left unpaid" outcome, "Done today" with the day's collections. **Later:**
upcoming appointments (scheduling).

## Decisions

| #   | Topic              | Decision                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Route and nav      | `/today`, the first item of the main nav ("Today"), shown with `payment:write`. The page also needs `visit:read`; without either it shows nothing to do and links to Patients.                                                                                                                                                         |
| T2  | Landing            | A session with `payment:write` and without `visit:write` (the front desk) lands on `/today`; everyone else on `/patients` as today. By permission, never by role.                                                                                                                                                                      |
| T3  | Ready for checkout | The C1 queue as cards, oldest first: patient, visit number, dentist, room, the services' names, when it finished (tenant time), the visit's outstanding in large type, a "Partly paid" mark when something was paid, and **Check out**. Empty: "No one is waiting to check out."                                                       |
| T4  | In the chair       | The branch's live visits (`tab=in_progress`), oldest first: patient, dentist, room, the running or paused time. Read-only for the front desk; a holder of `visit:write` gets a link to the workspace. Empty: "No visit in progress."                                                                                                   |
| T5  | Checkout panel     | **Check out** opens a right panel on the page (the open visit is `?visit=<id>` in the URL): eyebrow "Checkout", the patient's name, the visit number and dentist, then the same figures, discount edit and actions as the post-visit dialog. Recording a payment that settles the visit closes the panel and the card leaves the lane. |
| T6  | One checkout body  | The figures, the discount edit and the footer actions become one component, `VisitCheckout`, used by the post-visit dialog (after completion, unchanged for the completer) and by the panel.                                                                                                                                           |
| T7  | Header pill        | Becomes a plain link "Checkout · n" to `/today` (no menu), hidden on `/today` itself.                                                                                                                                                                                                                                                  |
| T8  | Refresh            | Both lanes poll every 30 s and on focus, and share the pill's query, so the count and the lane never disagree. Completing a visit and recording a payment already invalidate them.                                                                                                                                                     |
| T9  | Shortcuts          | None on the page: Find patient and New patient are already in the header on every screen.                                                                                                                                                                                                                                              |

## Screen

```
 Today                                                     Sun 4 Oct · Main St

 READY FOR CHECKOUT · 2
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ Lina Haddad    V-000123 · Dr. Reyes · Room 2 · finished 12:40            │
 │ Composite, Scaling                                   $113   [ Check out ]│
 ├──────────────────────────────────────────────────────────────────────────┤
 │ Karim Saleh    V-000122 · Dr. Reyes · Room 1 · finished 12:31            │
 │ Zircon crown                          Partly paid    $350   [ Check out ]│
 └──────────────────────────────────────────────────────────────────────────┘

 IN THE CHAIR · 2
 Omar Saleh · Dr. Reyes · Room 3 · 12:05
 Rana Khoury · Dr. Reyes · Room 1 · paused 04:40
```

## Files

- `routes/_app/today.tsx`; `features/today/today-page.tsx`, `checkout-lane.tsx`,
  `chair-lane.tsx`, `checkout-panel.tsx`, `today-search.ts`; `locales/{en,ar,fr}/today.json`.
- `features/clinical/dialogs/visit-checkout.tsx` (extracted) and `post-visit-summary-dialog.tsx`.
- `features/clinical/checkout-pill.tsx`, `checkout-queue.ts` (the shared query).
- `shell/nav-items.ts`, `features/auth/session-guard.ts`, `locales/*/shell.json`.

## Implementation notes

- The checkout's logic is a hook (`dialogs/use-visit-checkout.ts`) and its pieces are components
  (`dialogs/visit-checkout.tsx`: status pill, body, actions); the dialog and the panel each keep
  their own header and close button.
- There is no `today-search.ts`: the route parses `?visit=` itself.
- The panel is not closed by the payment's callback: the board shows it only while its visit is in
  the queue, so a visit paid in full (here or elsewhere) takes its panel with it.
- "In the chair" reads the visits list's In progress tab rather than `GET /visits/live`, which has
  no room and isn't branch-scoped.
- `features/today` composes `clinical` and `billing` reads and has no backend module of its own,
  unlike the other feature folders (CLAUDE.md §13).

- Changed after review (same day): **Check out opens the checkout dialog, not a right panel** —
  the same popup the completer sees, titled "Checkout · <patient>" (T5 and T6's panel are gone;
  there is no `checkout-panel.tsx`). After a full payment the dialog stays, showing "Paid in
  full", until Done; the card has already left the lane.
- The dialog's close button is always **Done** ("Pay later" is gone, for the completer too):
  closing never decides who collects. **Record payment** stays beside it while the account owes.
- The waiting cards are separate, larger cards in the header pill's amber, with a dark **Check
  out** button; the primary blue stays with clinical work.

- **Record payment is a step of the checkout dialog**, not a second popup: the payment form
  (`RecordPaymentForm`, the same one the standalone Record payment dialog shows) replaces the
  figures and comes back to them when recorded or cancelled.
- The payment form no longer has the "Remaining after this payment" box, and with it the
  allocation preview: the SPA no longer calls `POST /billing/payments/preview` (the route stays).

- **A visit leaves the lane once a payment is taken on it, even a partial one** (the queue is
  the owing visits with nothing paid): it has been checked out, and the remainder is a receivable
  shown in Visits → Unpaid and Payments → Outstanding. The cards therefore have no "Partly paid"
  mark. A visit partly covered by the patient's existing credit also counts as paid on.
- Recording a payment from the checkout dialog closes it (like Done); Cancel goes back to the
  figures. The dialog keeps its size when the payment step opens.

- Changed 2026-10-05 (ADR-0033): **Done on a waiting visit closes its checkout without a
  payment** (`POST /visits/:id/checkout`): the card leaves the lane and the amount stays a
  receivable. This is the stored "left unpaid" outcome listed as out of scope above. `Esc` only
  closes the dialog, and Done in the completer's "Visit recorded" dialog still leaves the visit
  waiting.

## Tests

- `today-page.spec.tsx`: both lanes and their order, the empty states, Check out opens the panel
  (URL), a settled visit closes it, no workspace link without `visit:write`.
- `checkout-pill.spec.tsx`: a link to `/today`, hidden there, absent without `payment:write`.
- `session-guard` and nav specs: the landing by permission, the nav item.
- The post-visit dialog spec stays green (the body is only moved).
- Playwright `checkout.spec.ts`: the front desk lands on Today and checks out from the lane.
