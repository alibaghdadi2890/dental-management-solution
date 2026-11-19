import type { Session } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { ViewTabs } from '@/components/ui/list';
import { CountsTab } from './counts-tab';
import type { InventorySearch, InventoryTab } from './inventory-search';
import { ReceiptsTab } from './receipts-tab';
import { ReportsTab } from './reports-tab';
import { StockTab } from './stock-tab';
import { SuppliersTab } from './suppliers-tab';

/**
 * Inventory (feature 20a, `inventory:read`): Stock · Receipts · Counts · Suppliers · Reports.
 * The tab, the branch and the filters are in the URL; an item opens in a side panel, a receipt,
 * a count and a supplier on their own page (the owner's layout answers of 2026-11-19).
 */
export function InventoryPage({
  session,
  search,
  onSearch,
}: {
  session: Session;
  search: InventorySearch;
  onSearch: (next: InventorySearch) => void;
}) {
  const { t } = useTranslation('inventory');
  const tenant = session.tenant;
  if (!tenant) return null;
  const tab: InventoryTab = search.tab ?? 'stock';
  const branchId = search.branch ?? session.branch?.id ?? session.branches[0]?.id ?? '';
  const patch = (next: Partial<InventorySearch>) => {
    onSearch({ ...search, ...next });
  };
  const tabs = [
    { key: 'stock' as const, label: t('tabs.stock') },
    { key: 'receipts' as const, label: t('tabs.receipts') },
    { key: 'counts' as const, label: t('tabs.counts') },
    { key: 'suppliers' as const, label: t('tabs.suppliers') },
    { key: 'reports' as const, label: t('tabs.reports') },
  ];
  return (
    <Page title={t('title')}>
      <ViewTabs
        label={t('tabs.label')}
        tabs={tabs}
        active={tab}
        onChange={(key) => {
          // The branch stays; the rest belongs to the tab it was set on.
          onSearch({
            ...(key === 'stock' ? {} : { tab: key }),
            ...(search.branch ? { branch: search.branch } : {}),
          });
        }}
      />
      {tab === 'stock' && (
        <StockTab session={session} branchId={branchId} search={search} onSearch={patch} />
      )}
      {tab === 'receipts' && (
        <ReceiptsTab session={session} branchId={branchId} search={search} onSearch={patch} />
      )}
      {tab === 'counts' && <CountsTab session={session} branchId={branchId} onSearch={patch} />}
      {tab === 'suppliers' && <SuppliersTab tenant={tenant} />}
      {tab === 'reports' && <ReportsTab session={session} search={search} onSearch={patch} />}
    </Page>
  );
}

/** The branch switch, for a clinic with several branches only (I2). */
export function BranchSwitch({
  session,
  branchId,
  onChange,
}: {
  session: Session;
  branchId: string;
  onChange: (branchId: string) => void;
}) {
  const { t } = useTranslation('inventory');
  if (session.branches.length < 2) return null;
  return (
    <label className="flex h-9 items-center gap-1.5 rounded-lg border border-border-control bg-surface ps-[11px] pe-1.5">
      <span className="text-[12.5px] leading-none text-ink-muted">{t('branch')}</span>
      <select
        aria-label={t('branch')}
        value={branchId}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="cursor-pointer border-none bg-transparent text-[12.5px] font-medium outline-none"
      >
        {session.branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
    </label>
  );
}
