# ADR-0108: Read-only overview strips may be drawn by hand

- Status: Accepted (amends 0071)
- Date: 2026-11-20

## Context

ADR-0071 puts every calendar view behind `react-big-calendar` in one file, so nobody builds a
scheduling grid by hand. The refreshed Today board (spec `2026-11-20-today-board-refresh-design.md`,
T7) wants the day at a glance: one horizontal lane per dentist, appointments as blocks along the
day and a line at now. `react-big-calendar` has no horizontal resource timeline; its day view runs
down the page, with one column per dentist, and is too tall for a card that is meant to be read in
a glance.

## Decision

1. A **read-only overview strip** may be drawn by hand: blocks placed by start and end, no
   dragging, no slot selection, no editing. Clicking a block opens the appointment where it is
   edited (the calendar). The Today timeline (`features/scheduling/today-timeline.tsx`) is the
   first.
2. Its geometry is a pure function beside it (`today-timeline-layout.ts`: span, block places,
   stacking, the now-line), with unit tests.
3. Any view where an appointment is booked, moved or resized stays `react-big-calendar`, behind
   `schedule-calendar.tsx` (ADR-0071).

## Consequences

- A second way to draw appointments exists. It shares the status words, and only the strip's block
  styles say how a status looks there.
- A strip that grows interactions (drag, resize, booking from empty time) has to move behind
  `schedule-calendar.tsx` instead.
