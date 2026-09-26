import { Outlet } from '@tanstack/react-router';
import { AppHeader } from './app-header';
import { Sidebar } from './sidebar';

/** POC app shell: 212px sidebar, 56px header, and a main area each screen fills and scrolls. */
export function AppShell() {
  return (
    <div className="flex h-full overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader />
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
