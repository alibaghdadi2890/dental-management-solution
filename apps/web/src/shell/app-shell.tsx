import { Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useSession } from '@/features/auth/session';
import { PaymentDialogProvider } from '@/features/billing/payments/payment-dialog-provider';
import { applyClinicLanguage } from '@/lib/i18n';
import { CommandPalette } from '@/features/patients/command-palette';
import { ActingTenantBanner } from './acting-tenant-banner';
import { AppHeader } from './app-header';
import { IdleTimeoutDialog } from './idle-timeout-dialog';
import { patientActions } from './nav-items';
import { Sidebar } from './sidebar';
import { useCommandPalette } from './use-command-palette';

/** POC app shell: 212px sidebar, 56px header, and a main area each screen fills and scrolls.
 * It owns the ⌘K patient palette (mounted once, opened by the header or the shortcut), and
 * applies the clinic's language until the user picks one (`applyClinicLanguage`). */
export function AppShell() {
  const { data: session } = useSession();
  const clinicLocale = session?.tenant?.locale;
  useEffect(() => {
    if (clinicLocale) applyClinicLanguage(clinicLocale);
  }, [clinicLocale]);
  const acting = session?.platformAdmin === true ? session.tenant : null;
  const canFind = patientActions(session).find;
  const palette = useCommandPalette(canFind);

  return (
    <PaymentDialogProvider>
      <div className="flex h-full overflow-hidden bg-background">
        <Sidebar session={session} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader
            session={session}
            onFindPatient={() => {
              palette.setOpen(true);
            }}
          />
          {acting && <ActingTenantBanner tenantId={acting.id} tenantName={acting.name} />}
          <main className="relative min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
        {session && <IdleTimeoutDialog idleSeconds={session.idleTimeoutSeconds} />}
        {canFind && <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />}
      </div>
    </PaymentDialogProvider>
  );
}
