import type { StaffUser } from '@dcm/contracts';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { InPanelSlot, PanelLayout } from '@/components/ui/panel-slot';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { AgreementsTab } from '@/features/compensation/agreements-tab';
import { ResetPasswordPanel } from '@/features/platform/tenant-detail/reset-password-panel';
import { type PanelTab, UserPanel } from '@/features/platform/tenant-detail/user-panel';
import { UsersTab } from '@/features/platform/tenant-detail/users-tab';
import { clinicRoles } from '@/features/roles/roles-source';
import { RolesTab } from '@/features/roles/roles-tab';
import { cn } from '@/lib/utils';
import { ChartSettingsSection } from './chart-settings-section';
import { SETTINGS_TABS, type SettingsTab } from './settings-tabs';

type StaffPanel =
  { kind: 'user'; user?: StaffUser; tab?: PanelTab } | { kind: 'resetPassword'; user: StaffUser };

/**
 * The clinic's Settings (ADR-0055): **Dental chart** (`tenant:write`), **Staff** (`user:write`)
 * and **Roles** (`role:read`), in the tenant detail page's tabs. The owner manages staff and who
 * may do what here — and, with `compensation:manage`, how each dentist is paid (a dentist's
 * Compensation tab, feature 13b); the platform admin keeps provisioning. Staff reuses the admin portal's table
 * and panels on the clinic's own tenant (the API ignores the tenant header for clinic users).
 */
export function SettingsPage({ tab: requested }: { tab: SettingsTab | undefined }) {
  const { t } = useTranslation('settings');
  const { data: session } = useSession();
  const canChart = usePermission('tenant:write');
  // Staff: managing accounts (`user:write`), or giving people access (`role:write`).
  const canManageStaff = usePermission('user:write');
  const canGiveAccess = usePermission('role:write');
  const canStaff = canManageStaff || canGiveAccess;
  const canRoles = usePermission('role:read');
  const canCompensate = usePermission('compensation:manage');
  const [panel, setPanel] = useState<StaffPanel | null>(null);
  const tenant = session?.tenant;
  const tenantId = tenant?.id;
  if (!tenant || !tenantId) return null;

  const available = SETTINGS_TABS.filter(
    (key) =>
      (key === 'chart' && canChart) ||
      (key === 'staff' && canStaff) ||
      (key === 'roles' && canRoles),
  );
  const tab = requested !== undefined && available.includes(requested) ? requested : available[0];
  const closePanel = () => {
    setPanel(null);
  };

  return (
    <PanelLayout>
      <Page title={t('title')} subtitle={t('subtitle')}>
        {available.length > 1 && (
          <nav
            aria-label={t('tabs.label')}
            className="mb-[18px] flex gap-0.5 border-b border-border"
          >
            {available.map((key) => (
              <Link
                key={key}
                to="/settings"
                search={{ tab: key }}
                aria-current={key === tab ? 'page' : undefined}
                className={cn(
                  '-mb-px flex h-9 items-center border-b-2 px-3 text-[13px] leading-none whitespace-nowrap',
                  key === tab
                    ? 'border-primary font-semibold text-primary'
                    : 'border-transparent font-medium text-ink-secondary hover:text-ink',
                )}
              >
                {t(`tabs.${key}`)}
              </Link>
            ))}
          </nav>
        )}
        {tab === 'chart' && <ChartSettingsSection />}
        {tab === 'staff' && (
          <UsersTab
            tenantId={tenantId}
            onNew={() => {
              setPanel({ kind: 'user' });
            }}
            onEdit={(user) => {
              setPanel({ kind: 'user', user });
            }}
            onAccess={(user) => {
              setPanel({ kind: 'user', user, tab: 'access' });
            }}
            onResetPassword={(user) => {
              setPanel({ kind: 'resetPassword', user });
            }}
          />
        )}
        {tab === 'roles' && <RolesTab source={clinicRoles(tenantId)} />}
      </Page>
      <InPanelSlot>
        {panel?.kind === 'user' && (
          <UserPanel
            key={`${panel.user?.id ?? 'new'}:${panel.tab ?? 'profile'}`}
            tenantId={tenantId}
            user={panel.user}
            initialTab={panel.tab}
            compensation={
              canCompensate && panel.user?.practitionerType === 'dentist' ? (
                <AgreementsTab profileId={panel.user.profileId} tenant={tenant} />
              ) : undefined
            }
            onClose={closePanel}
          />
        )}
        {panel?.kind === 'resetPassword' && (
          <ResetPasswordPanel
            key={panel.user.id}
            tenantId={tenantId}
            user={panel.user}
            onClose={closePanel}
          />
        )}
      </InPanelSlot>
    </PanelLayout>
  );
}
