import type { Tenant } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ErrorState, Pill, TenantMark } from '@/components/ui/list';
import { startActingIn } from '@/features/platform/acting-tenant';
import { tenantQuery } from '@/features/platform/platform-api';
import { useTenantStatusAction } from '@/features/platform/use-tenant-status-action';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AddBranchPanel } from './add-branch-panel';
import { BranchesTab } from './branches-tab';
import { OverviewTab } from './overview-tab';
import { SettingsTab } from './settings-tab';

export type TenantTab = 'overview' | 'branches' | 'settings';
const TABS: readonly TenantTab[] = ['overview', 'branches', 'settings'];

function Header({ tenant }: { tenant: Tenant }) {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const changeStatus = useTenantStatusAction();
  const suspended = tenant.status === 'suspended';

  const manage = () => {
    startActingIn(tenant.id);
    queryClient.removeQueries({ queryKey: ['session'] });
    void navigate({ to: '/' });
  };

  return (
    <>
      <Link
        to="/admin/tenants"
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] leading-none font-medium text-primary hover:underline"
      >
        <span aria-hidden className="rtl:-scale-x-100">
          {'‹'}
        </span>
        {t('detail.back')}
      </Link>
      <div className="mb-[18px] flex flex-wrap items-center gap-3.5">
        <TenantMark name={tenant.name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <h1 className="truncate text-[22px] leading-tight font-semibold tracking-[-0.02em]">
              {tenant.name}
            </h1>
            <Pill tone={suspended ? 'neutral' : 'success'}>
              {t(`tenants.status.${tenant.status}`)}
            </Pill>
          </div>
          <div className="mt-1 font-mono text-[12px] leading-snug text-ink-muted">
            {[tenant.slug, tenant.timeZone, tenant.currency].join(' · ')}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant={suspended ? 'outline' : 'danger'}
            onClick={() => {
              changeStatus(tenant, suspended ? 'active' : 'suspended');
            }}
          >
            {suspended ? t('detail.reactivate') : t('detail.suspend')}
          </Button>
          <Button variant="primary" onClick={manage}>
            {t('detail.manage')}
          </Button>
        </div>
      </div>
    </>
  );
}

/** Tenant detail (spec: platform admin portal): header like the patient record, 36px tabs. */
export function TenantDetailPage({ tenantId, tab }: { tenantId: string; tab: TenantTab }) {
  const { t } = useTranslation('admin');
  const tenant = useQuery(tenantQuery(tenantId));
  const [addingBranch, setAddingBranch] = useState(false);

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="flex min-h-full max-w-[1320px] flex-col px-[26px] pt-6">
          {tenant.isPending && (
            <div
              aria-busy="true"
              aria-label={t('detail.loading')}
              className="h-24 animate-shimmer rounded-xl bg-[linear-gradient(90deg,#f2f0ea_0,#faf8f4_50%,#f2f0ea_100%)] bg-[length:800px_100%]"
            />
          )}
          {tenant.isError && (
            <ErrorState
              title={t('detail.error.title')}
              body={t('detail.error.body')}
              requestId={tenant.error instanceof ApiError ? tenant.error.requestId : undefined}
              onRetry={() => void tenant.refetch()}
            />
          )}
          {tenant.data && (
            <>
              <Header tenant={tenant.data} />
              <nav
                aria-label={t('detail.tabs.label')}
                className="mb-[18px] flex gap-0.5 border-b border-border"
              >
                {TABS.map((key) => (
                  <Link
                    key={key}
                    to="/admin/tenants/$tenantId"
                    params={{ tenantId }}
                    search={{ tab: key }}
                    aria-current={key === tab ? 'page' : undefined}
                    className={cn(
                      '-mb-px flex h-9 items-center border-b-2 px-3 text-[13px] leading-none whitespace-nowrap',
                      key === tab
                        ? 'border-primary font-semibold text-primary'
                        : 'border-transparent font-medium text-ink-secondary hover:text-ink',
                    )}
                  >
                    {t(`detail.tabs.${key}`)}
                  </Link>
                ))}
              </nav>
              <div className="flex flex-1 flex-col pb-10">
                {tab === 'overview' && <OverviewTab tenant={tenant.data} />}
                {tab === 'branches' && (
                  <BranchesTab
                    tenantId={tenantId}
                    onAddBranch={() => {
                      setAddingBranch(true);
                    }}
                  />
                )}
                {tab === 'settings' && <SettingsTab tenant={tenant.data} />}
              </div>
            </>
          )}
        </div>
      </div>
      {addingBranch && (
        <AddBranchPanel
          tenantId={tenantId}
          onClose={() => {
            setAddingBranch(false);
          }}
        />
      )}
    </div>
  );
}
