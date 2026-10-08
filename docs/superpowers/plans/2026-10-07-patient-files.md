# Feature 8: patient files — implementation plan

Status: done (2026-10-07). The web files differ in name from the plan in places (`file-rows.tsx`
holds the record and visit rows; `files.spec.tsx` the component specs).

Spec: `docs/superpowers/specs/2026-10-07-patient-files-design.md` (D1–D20) over the feature 8
prompt (F1–F15). Branch `feat/patient-files`; the owner commits at the end. Per task: the affected
tests and that package's typecheck. Full lint, typecheck, tests, build, Playwright and one review
in task 12.

Paths are under `apps/api/src/modules/` (API) or `apps/web/src/features/` (web) unless they start
with `apps/`, `packages/` or `docs/`.

## Slice 1 — API

### 1. Contracts and permissions

Files: `packages/contracts/src/files.ts` (+ spec), `index.ts`, `permissions.ts` (`file:read`,
`file:write`, `file:archive`), `audit.ts` (area `files`); `roles/domain/system-roles.ts`.
Done when: contracts tests pass (`classifyUpload` incl. `.dcm`, sub-category per category,
`canArchiveFile` / `canRestoreFile`: F13).

### 2. Storage platform

Files: `apps/api/src/platform/storage/object-storage.ts` (`head`, `remove`, download disposition
and content type on `presignDownload`), its spec; `apps/api/test/support/fake-storage.ts` and
`test-app.ts` (an in-memory `ObjectStorage` for integration tests).
Done when: the storage spec passes.

### 3. `files` module

Files: `files/persistence/schema.ts`, `files.repository.ts`; `files/domain/` (`taken-at.ts` +
spec: EXIF wall time → instant in the tenant zone, the D10 order, the future check;
`file-errors.ts`; `file.ts`); `files/events/file-events.ts`; `files/application/files.service.ts`,
`merge-files.subscriber.ts`; `files/http/files.controller.ts`; `files.module.ts`, `index.ts`;
`apps/api/src/app.module.ts`; `clinical` `VisitsService.refsFor` (+ repository);
`apps/api/migrations/0038_files.sql` (table, RLS, grants of the three permissions).
Tests: `apps/api/test/integration/files.int-spec.ts` (intent → save → list → patch → archive /
restore with the 24 h rule → download; visit mismatch; incomplete upload; merge re-point), and a
`files` block in `tenant-isolation-services.int-spec.ts`.
Done when: those pass, plus `app.routes.spec.ts` and the api typecheck.

## Slice 2 — SPA

### 4. Foundations

Files: `files/files-api.ts`, `file-kind.ts` (labels, glyphs), `exif.ts` (+ spec),
`previews.ts` (canvas, HEIC, TIFF), `rotation.ts` (+ spec), `session-memory.ts`;
`apps/web/src/locales/{en,ar,fr}/files.json`, `lib/i18n.ts`, `types/i18next.d.ts`;
`apps/web/package.json` (`heic-to`, `utif2`).

### 5. Upload panel

Files: `files/upload/upload-batch.ts` (+ spec: reducer), `upload-panel.tsx`, `meta-fields.tsx`,
`tooth-field.tsx`, `upload-tile.tsx`, `use-uploader.ts`; `files/files-context.ts`,
`files-provider.tsx`; `apps/web/src/shell/app-shell.tsx`; `files/use-file-drop.tsx` (overlay,
paste).
Tests: reducer spec; a panel spec (category required, Save count, discard confirm).

### 6. Viewer

Files: `files/viewer/file-viewer.tsx`, `stage.tsx`, `zoom.ts` (+ spec), `details-panel.tsx`,
`filmstrip.tsx`, `shortcuts.tsx`, `use-archive-files.ts`.
Tests: zoom spec; a viewer spec (navigation wrap, rotate → Save orientation, read-only without
`file:write`).

### 7. Patient record

Files: `files/gallery/files-tab.tsx`, `gallery-filter.ts` (+ spec), `file-tile.tsx`,
`bulk-bar.tsx`; `files/recent-files-card.tsx`; `patients/record/record-search.ts`,
`patient-record-page.tsx`, `record-header.tsx` (badge), `overview-tab.tsx`;
`patients/panels/quick-view-panel.tsx`.
Tests: filter and grouping spec; a Files tab spec (filters, select → Compare, no Upload without
`file:write`).

### 8. Visit workspace

Files: `files/visit-files-strip.tsx`, `all-files-dialog.tsx`, `tooth-images.tsx`;
`clinical/workspace/visit-workspace-page.tsx`, `tooth-panel/tooth-panel.tsx`,
`clinical/dialogs/post-visit-summary-dialog.tsx`.

### 9. Activity

Files: `audit/sentence.ts` (+ spec rows), `activity-page.tsx` (file link), `locales/*/activity.json`.

## Slice 3 — finish

### 10. Playwright

`apps/web/e2e/files.spec.ts`: drop in a visit → category → Save → strip → viewer → rotate →
Save orientation → archive → Undo.

### 11. Docs

`docs/modules/files.md`, ADR-0038 (patient-level files, optional links, the module's edges),
ADR-0039 (originals immutable, previews made in the browser, stored orientation, object checks),
ADR-0040 (soft archive only), `docs/adr/README.md`, `docs/modules/roles.md`, `clinical.md`
(`refsFor`), `audit.md` (area), `CLAUDE.md` (module map, §9 exception).

### 12. Verification and review

Full lint, typecheck, unit + integration tests, build, Playwright; one review over the diff.
