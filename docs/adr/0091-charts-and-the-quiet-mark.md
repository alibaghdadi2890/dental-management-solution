# ADR-0091: Charts behind one folder, their colours, and the quiet mark

- Status: Accepted
- Date: 2026-11-18

## Context

The dashboards draw time charts, ranked bars, split bars and a weekday × hour grid, in three
languages and right to left. Feature 18 asked for minimal text with explanations behind a **!**,
which was never built.

## Decision

1. **Recharts** (the library shadcn/ui's chart is built on) is a dependency of `apps/web`,
   imported only inside `src/components/charts/`. It draws the time charts (grouped and stacked
   columns) and the sparklines; ranked bars, the segmented bar, the rate list and the grid are
   plain HTML and CSS in the same folder.
2. **Colour tokens** are defined once (`chart-tokens.ts`, against `--color-chart-*` in
   `styles.css`). Identity: Production `#3b3f8f`, Collected `#2a8a74`, Expenses `#c0702a`, Other
   `#8f8a80` — one colour per series on every chart, four at most. Magnitude: one indigo ramp.
   State: the Schedule's status colours, for appointment outcomes only. Text never wears a series
   colour. **Checked on 2026-11-18:** contrast on the white card 9.2, 4.2, 3.8 and 3.4 : 1; the
   smallest CIE76 ΔE between the three main series is 75 with normal vision, 51 (deuteranopia),
   40 (protanopia) and 29 (tritanopia), simulated with the Machado 2009 matrices.
3. Forms: columns for time, ranked bars for "which is biggest", one segmented bar for a whole,
   aligned small bars for rates, a shaded grid for weekday × hour. Never a pie, donut, gauge,
   radar, 3D, gradient or second scale.
4. Every chart card has _View as table_ (also what a screen reader gets) and, for who may export
   it, _Export CSV_, built in the browser from that table. No existing export is audited, nor is
   this one.
5. **The quiet mark** (`components/ui/info-mark.tsx`, on Radix Tooltip like `tooltip.tsx`): a
   small **!** next to a title, opening on hover, keyboard focus and tap. Explanations live there,
   never in helper sentences. **The figure tile** (`components/ui/figure-tile.tsx`) promotes the
   lab account figures' look; its change chip is coloured by good or bad, never by up or down,
   and carries an arrow and a sign too.

## Consequences

- Swapping the chart library touches one folder. Existing screens are not restyled in this
  feature.
