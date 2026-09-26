import { createFileRoute, redirect } from '@tanstack/react-router';

// Phase 1 has no Schedule, so Patients is the landing screen.
export const Route = createFileRoute('/_app/')({
  beforeLoad: () => redirect({ to: '/patients', throw: true }),
});
