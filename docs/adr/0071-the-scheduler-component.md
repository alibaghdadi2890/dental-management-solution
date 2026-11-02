# ADR-0071: The scheduler component

- Status: Accepted
- Date: 2026-10-30

## Context

CLAUDE.md §13 asks for a scheduler component with resource support, not a hand-built grid. The
licence must be free: FullCalendar's resource views are premium.

## Decision

`react-big-calendar` 1.20 (MIT) with its drag-and-drop addon, on a Luxon localizer in the clinic's time
zone, behind one file, `features/scheduling/schedule-calendar.tsx`.

A spike confirmed in a browser, before anything depended on it: resource columns in day; days ×
dentists in week (`resourceGroupingLayout`); drag between columns with a veto that snaps back; bottom-edge
resize; custom cards; per-column shading (`slotPropGetter`); RTL; a Vite 8 build; a tenant zone far from
the browser's; Beirut's DST changes. The chunk is 159 KB gzipped with React, split into `/schedule`.

Amended 2026-10-31: the week view no longer uses resources or `resourceGroupingLayout`. Its columns are
days, as in the design; `schedule-events.ts` (pure, tested) works out side-by-side lanes and collapses
three or more into one card. The library still lays out the cards.

## Consequences

- The default resize handle is 10×3 px and sits under the card's content. `schedule.css` widens the
  bottom one and hides the top one.
- `Settings.defaultZone` is global to Luxon. Only the calendar uses Luxon.
- The addon's default export needs an interop guard between Vite's dev server and its build.
- A week column is a day, so a drop or an empty slot there has no dentist: a dragged card keeps its
  own, and the page decides the rest.
- The library wraps each week header in its own button: a custom header must not be one, and the click
  comes through `onDrillDown`.
