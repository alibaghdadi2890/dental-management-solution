import { createFileRoute } from '@tanstack/react-router';
import { requireAppSession } from '@/features/auth/session-guard';
import { AppShell } from '@/shell/app-shell';

export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => requireAppSession(context.queryClient, location.pathname),
  component: AppShell,
});
