import type { Session } from '@dcm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { ViewTabs } from '@/components/ui/list';
import { usePermission } from '@/features/auth/use-permission';
import { LabOrderPanel } from './lab-order-panel';
import type { LabSearch, LabTab } from './lab-search';
import { LabsTab } from './labs-tab';
import { NewLabOrderPanel } from './new-lab-order-panel';
import { OrdersTab } from './orders-tab';
import { ReportsTab } from './reports-tab';

/**
 * Lab (feature 18, `lab:read`): the clinic's lab orders, the labs it works with (their accounts
 * for whoever sees lab money) and the reports. The tab, the filters and the open panel are in the
 * URL; an order opens in a side panel, a lab on its own page (`/labs/:labId`).
 */
export function LabPage({
  session,
  search,
  onSearch,
}: {
  session: Session;
  search: LabSearch;
  onSearch: (next: LabSearch) => void;
}) {
  const { t } = useTranslation('labs');
  const canManage = usePermission('lab:manage');
  const [creating, setCreating] = useState(false);
  const tenant = session.tenant;
  if (!tenant) return null;
  const tab: LabTab = search.tab ?? 'orders';
  const tabs = [
    { key: 'orders' as const, label: t('tabs.orders') },
    { key: 'labs' as const, label: t('tabs.labs') },
    { key: 'reports' as const, label: t('tabs.reports') },
  ];
  const patch = (next: Partial<LabSearch>) => {
    onSearch({ ...search, ...next });
  };

  return (
    <Page title={t('title')} subtitle={t('subtitle')}>
      <ViewTabs
        label={t('tabs.label')}
        tabs={tabs}
        active={tab}
        onChange={(key) => {
          onSearch(key === 'orders' ? {} : { tab: key });
        }}
      />
      {tab === 'orders' && (
        <OrdersTab
          session={session}
          search={search}
          onSearch={patch}
          canManage={canManage}
          onNew={() => {
            setCreating(true);
          }}
        />
      )}
      {tab === 'labs' && <LabsTab tenant={tenant} />}
      {tab === 'reports' && (
        <ReportsTab
          tenant={tenant}
          search={search}
          onSearch={patch}
          onOrders={(ids) => {
            onSearch({ ids: ids.join(',') });
          }}
        />
      )}
      {search.order && (
        <LabOrderPanel
          orderId={search.order}
          session={session}
          onClose={() => {
            patch({ order: undefined });
          }}
        />
      )}
      {creating && (
        <NewLabOrderPanel
          session={session}
          onClose={() => {
            setCreating(false);
          }}
          onCreated={(id) => {
            setCreating(false);
            patch({ order: id });
          }}
        />
      )}
    </Page>
  );
}
