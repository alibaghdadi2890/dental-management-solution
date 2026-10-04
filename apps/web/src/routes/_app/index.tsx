import { createFileRoute, redirect } from '@tanstack/react-router';
import { sessionQueryOptions } from '@/features/auth/session';
import { landingPath } from '@/features/auth/session-guard';

// Phase 1 has no Schedule: the landing screen is the Today board for whoever collects, Patients
// for everyone else (`landingPath`). The `_app` guard has loaded the session.
export const Route = createFileRoute('/_app/')({
  beforeLoad: ({ context }) => {
    const session = context.queryClient.getQueryData(sessionQueryOptions().queryKey);
    return redirect({ to: session ? landingPath(session) : '/patients', throw: true });
  },
});
