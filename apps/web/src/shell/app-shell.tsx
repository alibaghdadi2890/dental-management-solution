import { Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useSession } from '@/features/auth/session';
import { AdjustBalanceProvider } from '@/features/billing/adjust/adjust-balance-provider';
import { PaymentDialogProvider } from '@/features/billing/payments/payment-dialog-provider';
import { FilesProvider } from '@/features/files/files-provider';
import { TakeOutProvider } from '@/features/inventory/take-out-provider';
import { WaitlistProvider } from '@/features/scheduling/waitlist/waitlist-provider';
import { applyClinicLanguage } from '@/lib/i18n';
import { ContactPanelProvider } from '@/features/patients/contact-panel/contact-panel-provider';
import { ActingTenantBanner } from './acting-tenant-banner';
import { AppHeader } from './app-header';
import { IdleTimeoutDialog } from './idle-timeout-dialog';
import { searchScope } from './nav-items';
import { SearchPalette } from './search/search-palette';
import { Sidebar } from './sidebar';
import { useCommandPalette } from './use-command-palette';

/** POC app shell: 212px sidebar, 56px header, and a main area each screen fills and scrolls.
 * It owns the ⌘K search (mounted once, opened by the header or the shortcut) and the files upload
 * panel and viewer (`FilesProvider`), the contact panel (`ContactPanelProvider`), the search's
 * Take out panel (`TakeOutProvider`), the waitlist's Fill and Add panels (`WaitlistProvider`), and
 * applies the clinic's language until the user picks one (`applyClinicLanguage`). */
export function AppShell() {
  const { data: session } = useSession();
  const clinicLocale = session?.tenant?.locale;
  useEffect(() => {
    if (clinicLocale) applyClinicLanguage(clinicLocale);
  }, [clinicLocale]);
  const acting = session?.platformAdmin === true ? session.tenant : null;
  const scope = searchScope(session);
  const canFind = scope.patients || scope.stock;
  const palette = useCommandPalette(canFind);

  return (
    <PaymentDialogProvider>
      <AdjustBalanceProvider>
        <FilesProvider>
          <ContactPanelProvider>
            <TakeOutProvider>
              <WaitlistProvider>
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
                  {canFind && <SearchPalette open={palette.open} onOpenChange={palette.setOpen} />}
                </div>
              </WaitlistProvider>
            </TakeOutProvider>
          </ContactPanelProvider>
        </FilesProvider>
      </AdjustBalanceProvider>
    </PaymentDialogProvider>
  );
}
