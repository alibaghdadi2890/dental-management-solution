# Feature 9: chart marks — design

Source: the feature 9 prompt (M1–M16, screens 1–6, acceptance). This page records only what the
prompt leaves open or what the code contradicts, as decisions D1–D22, and the contracts. Where a
decision narrows or re-reads the prompt it says so. Owner module: `clinical`. No new module, no
new dependency edge, no new permission, no new package.

## Decisions

| #   | Topic                    | Decision                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Palette keys             | `rose` · `red` · `orange` · `amber` · `yellow` · `lime` · `green` · `teal` · `cyan` · `sky` · `blue` · `violet` · `purple` · `magenta` · `pink` · `brown`. No grey (it reads as "nothing here" or "missing") and no indigo (it is the selected ring).                                                                                                                                                   |
| D2  | Three variants per key   | `--color-mark-<key>` (today fill), `--color-mark-<key>-tint` (past fill), `--color-mark-<key>-strong` (edge, ring, icon on a light fill), plus `--color-mark-<key>-on` (the icon colour on the today fill: white or the strong variant, fixed per key). The prompt names two; M2 needs a saturated and a tinted fill as well as the edge.                                                               |
| D3  | Past tone is a mid-tone  | The tint is a mid-tone, not a pale wash: most marks on a chart are past ones, and sixteen pale tints cannot be told apart at 12 px. Today is told from past by the 1.5 px strong edge first, saturation second.                                                                                                                                                                                         |
| D4  | Contrast is tested       | A unit spec reads `styles.css` and checks every key: fill and tint against the surface, the planned ring and the selected ring (≥ 3:1 for the selected ring, visibly different hue or lightness for the planned one), `-on` against the fill (≥ 3:1), strong against the tint (≥ 3:1). This replaces the prompt's sixteen Playwright screenshots (D20).                                                 |
| D5  | Storage                  | `text` + CHECK against the key list (the prompt's "text enums"), `mark_priority smallint not null default 5` CHECK 0–9. `diagnoses.color` NOT NULL. `procedures`: CHECK `(charge_unit = 'per_tooth') = (color is not null)` and `icon is null or charge_unit = 'per_tooth'`.                                                                                                                            |
| D6  | Inputs                   | `color`, `icon`, `markPriority` are optional in the batch inputs. A new row without a colour gets the least-used key of its catalog (`leastUsedMarkColor`, pure, in contracts, used by the SPA too; ties → palette order). An update without the field keeps the stored value. For a service that is not `per_tooth` the server stores `null` for both, whatever was sent (the prompt's "API ignores"). |
| D7  | In progress is a ring    | Today an in-progress tooth is an amber _fill_, not a ring; the prompt says "amber ring (unchanged)". M1 bans status fills, so it becomes a 2 px `--color-warning-dot` ring, with the planned wash on unmarked cells. Planned stays the 1.5 px `--color-planned-border` ring. One ring at a time: selected > in progress > planned.                                                                      |
| D8  | Rings follow open plans  | The planned / in-progress ring shows whenever the tooth has an open plan, also on a tooth that already carries services (today it shows only when the overall `state` is `planned`). `ToothState` gains `planInProgress: boolean`, since `state` hides it behind `treated_today`.                                                                                                                       |
| D9  | Whole-tooth items        | **Re-reads M3/M4/M6 against the acceptance** ("16's cells are amber … with an amber crown chip in its band"). A whole-tooth item names all five surfaces: it competes for every cell by priority then date, _and_ it has a band chip. The same for a whole-tooth diagnosis in the Diagnoses view (M6 says band only; M7 says the views mirror each other).                                              |
| D10 | Nothing recorded is lost | Surface mode: a surface item that wins no cell (an older filling under a newer one on the same surface) also gets a band chip.                                                                                                                                                                                                                                                                          |
| D11 | Sort                     | Priority desc, date desc, then live before finished, then record id. A live service's date is the live visit's local date.                                                                                                                                                                                                                                                                              |
| D12 | Missing mark             | A record whose catalog id is not in `marks` (should not happen: inactive and soft-deleted items are included) derives with `color: null`, `icon: null`, priority 5: neutral `none` fill, a bordered neutral chip, still in the tooltip and the legend.                                                                                                                                                  |
| D13 | Marks in the SPA         | `useChartMarks(chart)`: the chart response's `marks`, overlaid by the catalog queries when they are in the cache. So a service added in the live visit is coloured at once, before the chart refetches, and Today's services and the tooth panel rows read their chip from the same map.                                                                                                                |
| D14 | Tooltip data             | `ToothDiagnosis` and `ToothService` carry `dentistName`. `deriveChart` takes `liveVisit: { date, dentistName } \| null` for the live services. `toToothRender` gets a `text` argument (translate, date format, surface short names, tooth label and name) and stays pure. `tooth-title.ts` is deleted; `titleParts` stays for the plan names.                                                           |
| D15 | Absent positions         | Missing / not erupted: the dashed or dotted box at the crown's size, aligned to the occlusal plane, the band row left empty. Its planned wash stays.                                                                                                                                                                                                                                                    |
| D16 | Implant post             | The implant outline wraps crown and band; the post keeps its place centred on the glyph's outer root-side edge, now beyond the band. (The prompt's "beside the band" would cost a chip slot.)                                                                                                                                                                                                           |
| D17 | Chart view store         | `useChartView()` over `useSyncExternalStore`: a module-level store, `localStorage` `dcm.chartView`, the `storage` event. Every mounted chart follows a switch at once, which `useState` (the sidebar hook) cannot do.                                                                                                                                                                                   |
| D18 | Highlight                | `useChartHighlight()` in the chart card and the read-only chart tab: `{ kind, id } \| null`. `Esc` clears the highlight first, the selection second. Selecting a tooth, switching view or dentition clears it. Painted cells of the highlighted item get the same 1.5 px ring as its chip.                                                                                                              |
| D19 | Chart priority           | Catalog rows have no ⋯ menu (only Delete). The 0–9 stepper and its helper line sit at the foot of the colour popover.                                                                                                                                                                                                                                                                                   |
| D20 | Focus ring test          | The focus ring is the selected ring, drawn outside the glyph on the card surface. Playwright: one fixture patient with a tooth per colour; arrow through them and assert each selected glyph carries the ring. No pixel baselines (the repo has none; they differ per platform).                                                                                                                        |
| D21 | Backfill                 | Migration 0039: per tenant and catalog, `row_number() over (order by created_at, id)` modulo 16 into the palette order. Icons stay `null`. Checked by hand on the local database (it has pre-feature tenants) when the migration is applied; no automated test, since the test database is always migrated empty. **Narrows the prompt's "API: migration backfill" test.**                              |
| D22 | Legend scope             | Dynamic groups count the teeth of the chart on screen (primary or permanent). An inactive catalog item is listed like any other.                                                                                                                                                                                                                                                                        |

Other narrowings:

- The patient list's quick view has no chart; the 8 px chart is on the record Overview and in the
  files tooth field. Both follow M9.
- `toToothRender`'s `dentition` option is dropped: the caller already resolves the presence.
- `ToothRender` gains `faded`, `compact`, and `ringed` on fills and band items (M11, M9).
- Chart settings preview (`chart-preview.tsx`) gets sample marks so the settings page shows the new
  glyph.

## Contracts (`packages/contracts`)

`marks.ts` (new): `MARK_COLORS`, `markColorSchema`, `MARK_ICONS`, `markIconSchema`,
`MARK_PRIORITY_DEFAULT = 5`, `markPrioritySchema` (int 0–9), `markColorVars(key)` →
`{ fill, tint, strong, on }` (CSS `var()` strings), `leastUsedMarkColor(used)`,
`catalogMarkSchema` `{ color, icon, priority, name, code, active }`.

`catalog.ts`: `serviceItemSchema` + `color` (nullable), `icon` (nullable), `markPriority`;
`diagnosisItemSchema` + `color`, `markPriority`; both input schemas + the optional fields (D6).

`clinical-records.ts`: `historyServiceSchema.procedureId`; `toothDiagnosisSchema`,
`toothServiceSchema` (the prompt's shapes + `dentistName`); `toothStateSchema` + `diagnoses`,
`services`, `planInProgress`; `patientChartSchema.marks: record(id → catalogMark)`.

`chart.ts`: `DeriveChartInput` + `marks`, `liveVisit`; `deriveChart` fills the lists (D9–D12).
`state`, `surfaces`, `wholeTooth`, `openPlanIds`, `presence`, `hasActiveDiagnosis` are computed as
today. `cellMark` is removed once the glyphs no longer call it.

## API (`clinical`)

- Migration `0039_chart_marks.sql`: five columns, backfill, NOT NULL and CHECKs (D5, D21).
- `default-catalog.ts`: a colour for every diagnosis and per-tooth service, an icon where one fits
  (EXT `extraction`, CMP/CGIC/CBIO/ONL `filling`, MCC/ZIR `crown`, IMP `implant`, PARO `cleaning`).
- `CatalogService`: D6 normalisation; the new fields in the audited before/after.
- `ChartService`: `marks` from the ids the records reference — one query per catalog, inactive and
  soft-deleted rows included — passed to `deriveChart` and returned. `finishedForPatient` already
  selects `procedure_id`; the mapping exposes it.
- No new route, no new error code, no new event.

## SPA (`apps/web/src/features/clinical`)

```ts
toToothRender(tooth, { view, mode, presence, selected, compact, highlight, text }): ToothRender

interface ToothRender {
  presence; rings: { selected; planned; inProgress }; faded: boolean; compact: boolean;
  body: Fill | null; cells: Partial<Record<SurfaceKey, Fill>>;
  band: BandItem[]; bandOverflow: number;
  dots: Dot[]; dotOverflow: number;
  title: string;
}
interface Fill { color: MarkColor | 'planned' | 'none'; tone: 'today' | 'past' | 'wash'; ringed: boolean }
interface BandItem { kind; id; code; color: MarkColor | null; icon; tone: 'today' | 'past'; label; ringed }
interface Dot { color: MarkColor | null; label }
```

New in `chart/`: `tooth-render.ts`, `mark-icons.tsx` (12 icons, 16-grid, 1.5 px strokes),
`mark-chip.tsx` (the one swatch / icon chip used by band, legend, lists and pickers),
`legend-items.ts` (pure: groups, counts, top 8), `use-chart-view.ts`, `chart-view-switch.tsx`,
`use-chart-highlight.ts`, `use-chart-marks.ts`. `ToothGlyph` and `PanelGlyph` render a
`ToothRender` and derive nothing; the panel glyph keeps its pending-surface overlay.

Sizes (M8): surface glyph `3·size + 2 gaps + 2 padding` wide, `4·size + 3 gaps + 2 padding` high;
simple body `2.2·size × 3.6·size` with the root-end `0.9·size` as band. `chartGlyphBox` returns
both; `fit-cell-size.ts` is width-only and unchanged in logic.

## Tests

- contracts: `marks` (least-used, schema refinements), `deriveChart` (lists, sort, inactive,
  missing mark, whole-tooth, `planInProgress`).
- api: catalog batch with marks (default colour, non-`per_tooth` nulled, audit); chart response
  carries the marks of inactive items; tenant isolation suite unchanged and passing.
- web: `toToothRender` table over view × mode × presence, band overflow, compact, highlight,
  title; glyph spec per view; legend items + legend highlight; catalog draft (least-used on add,
  marks nulled off `per_tooth`) and row (pickers hidden); `use-chart-view`; palette contrast (D4).
- Playwright `chart-marks.spec.ts`: the first two acceptance bullets, and D20.

## Out of scope / follow-ups

Everything in the prompt's Out of scope list; an automated backfill test (D21); updating the POC
chart.

## Implementation notes (2026-10-08)

- **D4** as built: `palette.spec.ts` reads `styles.css` and checks, per key, the icon colour on
  the fill and the strong variant on the tint (WCAG ≥ 3:1), the strong variant on the card
  (≥ 4.5:1), both fills against the surface and the three rings, today against before, and every
  pair of keys against each other (RGB distance). The mark tokens sit in an `@theme static` block:
  they are read from inline styles only, and Tailwind drops theme variables no utility uses.
- **D20** as built: the sixteen-colour check is a component spec (`tooth-glyph.spec.tsx`: a tooth
  fully painted in each colour, today and before, keeps the selected ring), not a Playwright walk.
  The Playwright flow asserts real computed colours instead, so a palette that does not reach the
  page fails it.
- An active diagnosis is drawn at the **today** tone: it is a present fact. The legend's "Done
  today / Done earlier" lines show only when services are on the teeth.
- The band's chips share the tooth's width when three and `+N` would not fit at full size (12 px
  cells, and simple mode); a chip too narrow for its icon shows its colour alone.
- The Both view's dots sit in a row of their own between the number and the glyph, present for
  every tooth so the rows stay straight.
- A tooth's hover title has a line per item; its accessible name is the same words on one line.
  What is at the position (missing, implant) stays right after the tooth's name, where a screen
  reader hears it first, rather than last as M14 lists it.
- Moving a service off the tooth and back in one edit restores the mark it was saved with.
- The lists' chips (Today's services, the tooth panel) read the service catalog; a service
  removed from the catalog shows no chip there.
- The legend's groups, counts and "+N more" are covered by the legend's component spec; there is
  no separate spec for `legend-items.ts`.
- The tooth panel lists the band's marks (up to three and `+N`) as text chips beside the glyph.
- **Review changes** (same day, one review over the diff):
  - D5/D6: a service moved off the tooth keeps its stored mark, so its earlier tooth records keep
    their colour; the CHECK is `charge_unit <> 'per_tooth' or color is not null`. A new service
    off the tooth still has none, and what is sent for one is ignored.
  - D11 as built: priority, then the live visit's work, then the most recent date, then the
    record made last.
  - D13 as built: the chart read's marks win; the cached catalogs only fill in items it lacks.
  - D18: the highlight is cleared for good by a view switch or a chart (dentition) switch, and
    `Esc` clears it only with the focus in the chart card or nowhere, with no dialog or menu open
    and not while typing in a field.
  - The Catalog pickers' options are toggle buttons (`aria-pressed`), not radios.
