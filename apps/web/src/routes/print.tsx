import { createFileRoute, Outlet } from '@tanstack/react-router';
import { requireAppSession } from '@/features/auth/session-guard';

/** Printables (feature 5, B9): signed-in pages without the app shell, opened in a new tab. */
export const Route = createFileRoute('/print')({
  beforeLoad: ({ context, location }) => requireAppSession(context.queryClient, location.pathname),
  component: Outlet,
});
