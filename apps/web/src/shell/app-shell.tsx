import { Outlet } from '@tanstack/react-router';
import { useSession } from '@/features/auth/session';
import { ActingTenantBanner } from './acting-tenant-banner';
import { AppHeader } from './app-header';
import { IdleTimeoutDialog } from './idle-timeout-dialog';
import { Sidebar } from './sidebar';

/** POC app shell: 212px sidebar, 56px header, and a main area each screen fills and scrolls. */
export function AppShell() {
  const { data: session } = useSession();
  const acting = session?.platformAdmin === true ? session.tenant : null;

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <Sidebar session={session} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader session={session} />
        {acting && <ActingTenantBanner tenantId={acting.id} tenantName={acting.name} />}
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
      {session && <IdleTimeoutDialog idleSeconds={session.idleTimeoutSeconds} />}
    </div>
  );
}
