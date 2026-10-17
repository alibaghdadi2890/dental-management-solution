# A check for open diagnoses at Complete visit: implementation plan

Spec: `docs/superpowers/specs/2026-10-17-unresolved-diagnoses-check-design.md` (D1–D6). No branch
or commit until the owner asks. Paths are under `apps/web/src/features/clinical/`.

## 1. The rule (D1)

- `dialogs/diagnoses-to-resolve.ts`: `diagnosesToResolve(visit, chart)` returns
  `{ record, services }[]`: the diagnosis, and the services on that tooth today (or the one that
  performed its plan), in FDI order.
- `dialogs/diagnoses-to-resolve.spec.ts`: the spec's cases.

Done: unit tests green.

## 2. The check in the Visit Summary (D2–D5)

- `dialogs/visit-summary-dialog.tsx`: `onComplete` checks after the flush and the settle, then
  switches to `ResolveCheck` (a component in the same file, or `dialogs/resolve-check.tsx` if
  the file grows). The resolve uses `useVisitMutations(visit.id).resolveDiagnosis`, and the
  completion path is shared with the direct one.
- Strings `summary.resolve.*` in `locales/{en,fr,ar}/clinical.json`.
- `dialogs/visit-summary-dialog.spec.tsx`: the spec's dialog cases.

Done: web tests and typecheck green.

## 3. Verification, review

- Full `pnpm lint`, `pnpm typecheck`, web tests (`--maxWorkers=2`), `pnpm build`. Then the
  Playwright flows that complete visits (`visit.spec.ts`, `visit-flows.spec.ts`,
  `checkout.spec.ts`, `payments.spec.ts`), since a visit with a treated, diagnosed tooth now
  stops at the check. Update any flow that does so.
- `docs/modules/clinical.md`: one line under the Visit Summary.
- One review over the diff.

Done: everything green; changes left uncommitted for the owner.
