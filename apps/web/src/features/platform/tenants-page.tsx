import type { PlatformTenant, TenantStatus } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { Button, IconButton } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  Pill,
  SearchInput,
  SkeletonRows,
  TableCard,
  TableHead,
  TenantMark,
  ViewTabs,
} from '@/components/ui/list';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { NewTenantPanel } from './new-tenant-panel';
import { tenantsQuery } from './platform-api';
import { useTenantStatusAction } from './use-tenant-status-action';

const COLUMNS = 'minmax(220px,1.6fr) 84px 72px 150px 80px 110px 100px 44px';

export function TenantsPage() {
  const { t, i18n } = useTranslation('admin');
  const navigate = useNavigate();
  const [view, setView] = useState<TenantStatus>('active');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const tenants = useQuery(tenantsQuery());
  const changeStatus = useTenantStatusAction();

  const all = useMemo(() => tenants.data ?? [], [tenants.data]);
  const inView = all.filter((tenant) => tenant.status === view);
  const needle = search.trim().toLowerCase();
  const rows = needle
    ? inView.filter(
        (tenant) => tenant.name.toLowerCase().includes(needle) || tenant.slug.includes(needle),
      )
    : inView;
  const count = (status: TenantStatus) =>
    tenants.data ? all.filter((tenant) => tenant.status === status).length : undefined;

  const open = (tenant: PlatformTenant) => {
    void navigate({ to: '/admin/tenants/$tenantId', params: { tenantId: tenant.id } });
  };

  const body = () => {
    if (tenants.isPending) {
      return <SkeletonRows columns={COLUMNS} label={t('tenants.loading')} />;
    }
    if (tenants.isError) {
      return (
        <ErrorState
          title={t('tenants.error.title')}
          body={t('tenants.error.body')}
          requestId={tenants.error instanceof ApiError ? tenants.error.requestId : undefined}
          onRetry={() => void tenants.refetch()}
        />
      );
    }
    if (inView.length === 0) {
      const empty = view === 'active' ? 'empty' : 'emptySuspended';
      return (
        <EmptyState
          title={t(`tenants.${empty}.title`)}
          body={t(`tenants.${empty}.body`)}
          action={
            view === 'active' ? (
              <Button
                variant="primary"
                onClick={() => {
                  setCreating(true);
                }}
              >
                {t('tenants.new')}
              </Button>
            ) : undefined
          }
        />
      );
    }
    if (rows.length === 0) {
      return (
        <EmptyState
          title={t('tenants.noResults.title')}
          body={t('tenants.noResults.body', { view: t(`tenants.tabs.${view}`) })}
          action={
            <Button
              variant="outline"
              size="toolbar"
              onClick={() => {
                setSearch('');
              }}
            >
              {t('tenants.noResults.clear')}
            </Button>
          }
        />
      );
    }
    return rows.map((tenant) => (
      <div
        key={tenant.id}
        role="row"
        onClick={() => {
          open(tenant);
        }}
        className="grid min-h-14 cursor-pointer items-center gap-2.5 border-t border-row-divider bg-surface px-3 py-1.5 hover:bg-faint"
        style={{ gridTemplateColumns: COLUMNS }}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <TenantMark name={tenant.name} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] leading-tight font-medium">
              {tenant.name}
            </span>
            <span className="block font-mono text-[11.5px] leading-snug text-ink-muted">
              {tenant.slug}
            </span>
          </span>
        </span>
        <span className="font-mono text-[12.5px] text-ink-secondary tabular-nums">
          {tenant.branchCount}
        </span>
        <span className="font-mono text-[12.5px] text-ink-secondary tabular-nums">
          {tenant.userCount}
        </span>
        <span className="truncate font-mono text-[12.5px] text-ink-secondary">
          {tenant.timeZone}
        </span>
        <span className="font-mono text-[12.5px] text-ink-secondary">{tenant.currency}</span>
        <span className="text-[12.5px] whitespace-nowrap text-ink-secondary">
          {formatDate(tenant.createdAt, {
            timeZone: tenant.timeZone,
            locale: i18n.resolvedLanguage ?? 'en',
          })}
        </span>
        <span>
          <Pill tone={tenant.status === 'active' ? 'success' : 'neutral'}>
            {t(`tenants.status.${tenant.status}`)}
          </Pill>
        </span>
        <span
          className="justify-self-end"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <Menu>
            <MenuTrigger asChild>
              <IconButton aria-label={t('tenants.menu.label', { name: tenant.name })}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="3.5" cy="8" r="1.3" />
                  <circle cx="8" cy="8" r="1.3" />
                  <circle cx="12.5" cy="8" r="1.3" />
                </svg>
              </IconButton>
            </MenuTrigger>
            <MenuContent>
              <MenuItem
                onSelect={() => {
                  open(tenant);
                }}
              >
                {t('tenants.menu.open')}
              </MenuItem>
              {tenant.status === 'active' ? (
                <MenuItem
                  tone="danger"
                  onSelect={() => {
                    changeStatus(tenant, 'suspended');
                  }}
                >
                  {t('tenants.menu.suspend')}
                </MenuItem>
              ) : (
                <MenuItem
                  onSelect={() => {
                    changeStatus(tenant, 'active');
                  }}
                >
                  {t('tenants.menu.reactivate')}
                </MenuItem>
              )}
            </MenuContent>
          </Menu>
        </span>
      </div>
    ));
  };

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1">
        <Page
          title={t('tenants.title')}
          subtitle={t('tenants.subtitle')}
          actions={
            <Button
              variant="primary"
              onClick={() => {
                setCreating(true);
              }}
            >
              {t('tenants.new')}
            </Button>
          }
        >
          <ViewTabs
            label={t('tenants.tabs.label')}
            active={view}
            onChange={setView}
            tabs={[
              { key: 'active', label: t('tenants.tabs.active'), count: count('active') },
              { key: 'suspended', label: t('tenants.tabs.suspended'), count: count('suspended') },
            ]}
          />
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t('tenants.search')}
              label={t('tenants.searchLabel')}
            />
          </div>
          <TableCard minWidth={940}>
            <TableHead
              columns={COLUMNS}
              labels={[
                t('tenants.columns.tenant'),
                t('tenants.columns.branches'),
                t('tenants.columns.users'),
                t('tenants.columns.timeZone'),
                t('tenants.columns.currency'),
                t('tenants.columns.created'),
                t('tenants.columns.status'),
                '',
              ]}
            />
            {body()}
          </TableCard>
        </Page>
      </div>
      {creating && (
        <NewTenantPanel
          onClose={() => {
            setCreating(false);
          }}
          onCreated={() => {
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}
