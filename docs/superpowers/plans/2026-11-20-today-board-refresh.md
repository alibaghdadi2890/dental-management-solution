# Today board refresh — plan

Spec: `docs/superpowers/specs/2026-11-20-today-board-refresh-design.md`. Web only. Lean process:
inline build, affected tests + web typecheck per task, full checks once at the end, the user
commits. Builds on the uncommitted waitlist work in the same tree (its files keep their changes).

1. **Board kit** — `apps/web/src/components/board/`: `board.tsx` (`BoardProvider`, `Board`,
   `Band`, armed flag, collapse store in `localStorage`), `today-card.tsx`, `board-more.tsx`,
   `use-flip.ts`, `use-arrival.ts`, `use-now.ts`, `board.css` (eight hues, bloom / row / bump
   keyframes, reduced motion). Done: typecheck; `board.spec.tsx` (band hidden when empty, arrival
   class only after arming, collapse remembered).
2. **Scheduling cards** — split `features/scheduling/today-schedule.tsx` into Schedule (timeline),
   Next up, Waiting, Coming up, Follow-ups on `TodayCard`; `today-timeline.tsx` +
   `today-timeline-layout.ts` (pure geometry) + `waitingTone`. Openings lane on `TodayCard`.
   Done: `today-timeline-layout.spec.ts`; scheduling specs green.
3. **Other cards** — checkout lane, chair lane (`features/today/`), Lab work, Stock (+ _Receive_),
   Expenses (+ _+ Expense_ panel) on `TodayCard`, no empty notes; 60 s refetch at the Today call
   sites. Done: their specs green.
4. **Today page** — three bands, skeleton, all-clear line, arming; i18n (en/ar/fr). Done:
   `today-page.spec.tsx` updated (empty lanes absent, all-clear line).
5. **Docs** — ADR-0108 (read-only overview strips), CLAUDE.md §13 line, ADR README. e2e: replace
   the empty-note expectation in `checkout.spec.ts`.
6. **Final** — web lint, typecheck, unit tests, `pnpm format:check`; review in the browser;
   one code review over the change.
