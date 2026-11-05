# Plan: edit and restore appointments (feature 16)

Spec: `docs/superpowers/specs/2026-11-05-appointment-edit-restore-design.md`. Lean process: build
inline, run the affected tests per task, the full suite once at the end; the user commits.

1. **Contracts** (`packages/contracts/src/scheduling.ts`): `canRestore`, `restoreAppointmentSchema`,
   `editAppointmentSchema`; spec cases. Done: contracts tests + typecheck pass.
2. **Domain**: `cancelled → booked | confirmed` in `appointment-lifecycle.ts` and its table spec.
3. **API**: `AppointmentRestored`, `AppointmentEdited` events (exported for `alerts`);
   `FollowUpsService.relink`; `AppointmentsService.restore` and `.edit`; routes in the controller;
   alerts pings on restore. Done: API typecheck.
4. **Integration tests** in `scheduling.int-spec.ts` (restore, edit). Done: they pass.
5. **Web API + abilities**: `restoreAppointment`, `editAppointment`; `restore` and `edit` in
   `useAppointmentAbilities`; the restore action.
6. **Popover**: Restore (dry run, warnings inline, Restore anyway).
7. **Panel**: edit mode of `NewAppointmentPanel`; the page opens it from the card's button.
8. **Card + layout**: pencil button; the strip (`schedule-events.ts` ignores cancelled in lanes and
   clusters; layout function in `schedule-calendar.tsx`; CSS). Unit tests.
9. **i18n** (en, ar, fr) for every new string.
10. **Docs**: ADR-0075, CLAUDE.md §8 and §12, `docs/modules/scheduling.md`, ADR README.
11. **e2e** step in `appointments.spec.ts`; full lint, typecheck, tests, Playwright; one review.
