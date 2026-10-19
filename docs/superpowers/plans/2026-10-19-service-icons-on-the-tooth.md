# Plan: service icons on the tooth

Spec: `docs/superpowers/specs/2026-10-19-service-icons-on-the-tooth-design.md`.

1. **Contracts.** `serviceItemInputSchema` refuses a per-tooth row with `color: null` and
   `icon: null`; comments on `serviceItemSchema.color`. Done: `catalog.spec.ts` passes.
2. **API.** `procedures_mark_per_tooth` CHECK in `persistence/schema.ts` + migration 0049;
   `saveServices` keeps `color: null`, refuses neither (`CatalogMarkRequiredError`). Done: the
   catalog integration test saves an icon-only row and refuses one with neither.
3. **Render.** `Fill.icon`, Both-view colour from the diagnosis, surface-mode `crownIcon` and band
   de-duplication in `tooth-render.ts`. Done: `tooth-render.spec.ts` covers D3–D5.
4. **Glyphs.** Large icon in the chart/history body and over the crown, panel simple body;
   `fillStyle` plain icon colours; `MarkChip` colourless icon; `ServiceMark`. Done:
   `tooth-glyph.spec.tsx` passes.
5. **Catalog screen.** No colour option, None disabled, draft rule, row display. Done:
   `catalog-draft.spec.ts` passes.
6. **Docs.** ADR-0054, ADR-0042 status line, `docs/modules/clinical.md`, CLAUDE.md §4 table
   wording if needed. Then full typecheck, lint, tests.
