import type { Session, StockLabelKind, StockRow } from '@dcm/contracts';
import { STOCK_LABEL_KINDS } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { InfoMark } from '@/components/ui/info-mark';
import {
  EmptyState,
  ErrorState,
  FilterChip,
  SearchInput,
  SkeletonRows,
  TableCard,
  TableHead,
} from '@/components/ui/list';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatDayMonth, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CategoriesPanel } from './categories-panel';
import {
  categoriesQuery,
  downloadStock,
  invalidateInventory,
  reportCount,
  stockQuery,
  suppliersQuery,
  takeOut,
} from './inventory-api';
import { BranchSwitch } from './inventory-page';
import type { InventorySearch } from './inventory-search';
import { useInventoryWords } from './inventory-words';
import { ItemPanel } from './item-panel';
import { matchesItem } from './item-match';
import { ItemsEditor } from './items-editor';
import { ReorderView } from './reorder-view';
import { SettingsPanel } from './settings-panel';
import { StockLabel } from './stock-label';
import { TakeOutPanel } from './take-out-panel';
import { useUndoTakeOut } from './use-undo-take-out';

const FIGURE = 'text-end font-mono tabular-nums';

/**
 * The Stock tab (C1): the items of the branch with what is on hand, the one label and, for whoever
 * sees inventory money, the value. A row's _Take out_ removes one pack (or one unit) with one more
 * tap and offers _Undo_; an item opens its panel. _Edit items_ and the reorder list replace the
 * list (the owner's layout answer).
 */
export function StockTab({
  session,
  branchId,
  search,
  onSearch,
}: {
  session: Session;
  branchId: string;
  search: InventorySearch;
  onSearch: (next: Partial<InventorySearch>) => void;
}) {
  const { t, i18n, quantity, categoryName, packWord, unitWord } = useInventoryWords();
  const locale = i18n.resolvedLanguage ?? 'en';
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const undo = useUndoTakeOut();
  const canWrite = usePermission('inventory:write');
  const canManage = usePermission('inventory:manage');
  const canMoney = usePermission('inventory:money_read');
  const [panel, setPanel] = useState<'takeOut' | 'categories' | 'settings'>();
  const [busy, setBusy] = useState<string>();
  const stock = useQuery(stockQuery(branchId));
  const categories = useQuery(categoriesQuery());
  const suppliers = useQuery(suppliersQuery(true));
  const tenant = session.tenant;
  if (!tenant) return null;

  if (search.view === 'edit' && canManage) {
    return (
      <ItemsEditor
        onDone={() => {
          onSearch({ view: undefined });
        }}
      />
    );
  }
  if (search.view === 'reorder') {
    return (
      <ReorderView
        session={session}
        branchId={branchId}
        onBack={() => {
          onSearch({ view: undefined });
        }}
      />
    );
  }

  const byCategory = new Map((categories.data ?? []).map((row) => [row.id, row] as const));
  const money = (amount: string) => formatMoney({ amount, currency: tenant.currency }, locale);
  const rows = (stock.data?.rows ?? []).filter(
    (row) =>
      (search.inactive === true || row.active) &&
      (!search.category || row.categoryId === search.category) &&
      (!search.supplier || row.usualSupplierId === search.supplier) &&
      (!search.status || row.labels.some((label) => label.kind === search.status)) &&
      matchesItem(row, search.q ?? ''),
  );
  const columns = canMoney
    ? 'minmax(200px,1.6fr) minmax(120px,1fr) minmax(170px,1.2fr) 150px 110px 120px'
    : 'minmax(200px,1.6fr) minmax(120px,1fr) minmax(170px,1.2fr) 150px 120px';

  const run = async (row: StockRow, units: number, allowExpired = false): Promise<void> => {
    setBusy(row.itemId);
    try {
      const result = await takeOut(
        { branchId, items: [{ itemId: row.itemId, quantity: units }], allowExpired },
        crypto.randomUUID(),
      );
      await invalidateInventory(queryClient);
      toast(t('takeOut.done', { what: quantity(units, row), item: row.name }), {
        tone: 'success',
        ...undo(result.movements[0]?.id),
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'inventory.expired_batch') {
        confirm({
          title: t('takeOut.expiredTitle'),
          body: t('takeOut.expiredBody', {
            date: error.problem.expiresOn ? formatDayMonth(error.problem.expiresOn, locale) : '',
          }),
          okLabel: t('takeOut.anyway'),
          tone: 'warn',
          onConfirm: () => run(row, units, true),
        });
      } else if (error instanceof ApiError && error.code === 'inventory.not_enough_stock') {
        toast(t('takeOut.notEnough', { what: quantity(error.problem.onHand ?? 0, row) }), {
          tone: 'danger',
          actionLabel: t('takeOut.reportCount'),
          onAction: () => {
            void reportCount(row.itemId, branchId)
              .then(() => invalidateInventory(queryClient))
              .then(() => {
                toast(t('takeOut.reported'), { tone: 'info' });
              });
          },
        });
      } else {
        toast(apiErrorMessage(error, i18n), { tone: 'danger' });
      }
    } finally {
      setBusy(undefined);
    }
  };

  const statusOptions = [
    { value: '', label: t('filters.any') },
    ...STOCK_LABEL_KINDS.map((kind: StockLabelKind) => ({
      value: kind,
      label: t(`label.${kind}`),
    })),
  ];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <BranchSwitch
          session={session}
          branchId={branchId}
          onChange={(branch) => {
            onSearch({ branch });
          }}
        />
        <SearchInput
          value={search.q ?? ''}
          onChange={(q) => {
            onSearch({ q: q === '' ? undefined : q });
          }}
          placeholder={t('filters.search')}
          label={t('filters.search')}
          maxLength={100}
        />
        <FilterChip
          label={t('filters.category')}
          value={search.category ?? ''}
          options={[
            { value: '', label: t('filters.all') },
            ...(categories.data ?? [])
              .filter((row) => row.active)
              .map((row) => ({ value: row.id, label: categoryName(row) })),
          ]}
          onChange={(category) => {
            onSearch({ category: category || undefined });
          }}
        />
        <FilterChip
          label={t('filters.status')}
          value={search.status ?? ''}
          options={statusOptions}
          onChange={(status) => {
            onSearch({ status: (status || undefined) as StockLabelKind | undefined });
          }}
        />
        <FilterChip
          label={t('filters.supplier')}
          value={search.supplier ?? ''}
          options={[
            { value: '', label: t('filters.all') },
            ...(suppliers.data ?? []).map((row) => ({ value: row.id, label: row.name })),
          ]}
          onChange={(supplier) => {
            onSearch({ supplier: supplier || undefined });
          }}
        />
        <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
          <Switch
            checked={search.inactive === true}
            onCheckedChange={(on) => {
              onSearch({ inactive: on ? true : undefined });
            }}
            label={t('filters.inactive')}
          />
          {t('filters.inactive')}
        </label>
        <div className="ms-auto flex items-center gap-2">
          {canWrite && (
            <Link
              to="/inventory/receipts/new"
              search={{ branch: branchId }}
              className="inline-flex h-9 items-center rounded-lg border border-primary bg-primary px-3.5 text-[12.5px] font-medium text-primary-foreground hover:bg-primary-hover"
            >
              {t('stock.receive')}
            </Link>
          )}
          <Menu>
            <MenuTrigger asChild>
              <Button aria-label={t('stock.more')}>{'⋯'}</Button>
            </MenuTrigger>
            <MenuContent>
              {canWrite && (
                <MenuItem
                  onSelect={() => {
                    setPanel('takeOut');
                  }}
                >
                  {t('stock.takeOutSeveral')}
                </MenuItem>
              )}
              <MenuItem
                onSelect={() => {
                  onSearch({ view: 'reorder' });
                }}
              >
                {t('stock.reorder')}
              </MenuItem>
              {canManage && (
                <>
                  <MenuSeparator />
                  <MenuItem
                    onSelect={() => {
                      onSearch({ view: 'edit' });
                    }}
                  >
                    {t('stock.editItems')}
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      setPanel('categories');
                    }}
                  >
                    {t('stock.categories')}
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      setPanel('settings');
                    }}
                  >
                    {t('stock.expiryWindow')}
                  </MenuItem>
                </>
              )}
              <MenuSeparator />
              <MenuItem
                onSelect={() => {
                  void downloadStock(branchId);
                }}
              >
                {t('stock.export')}
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>
      {canMoney && stock.data?.value != null && (
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
          <span className="flex items-center gap-1.5 text-ink-muted">
            {t('stock.value')}
            <InfoMark about={t('stock.value')}>{t('info.value')}</InfoMark>
          </span>
          <span dir="ltr" className="font-mono text-[18px] font-semibold tabular-nums">
            {money(stock.data.value)}
          </span>
          <UnpricedNote unpriced={stock.data.unpriced} />
        </div>
      )}
      <TableCard minWidth={canMoney ? 920 : 800}>
        <div role="table" aria-label={t('tabs.stock')}>
          <TableHead
            columns={columns}
            labels={[
              t('stock.columns.item'),
              t('stock.columns.category'),
              <span key="o" className="block text-end">
                {t('stock.columns.onHand')}
              </span>,
              t('stock.columns.status'),
              ...(canMoney
                ? [
                    <span key="v" className="block text-end">
                      {t('stock.columns.value')}
                    </span>,
                  ]
                : []),
              '',
            ]}
          />
          {stock.isPending ? (
            <SkeletonRows columns={columns} label={t('loading')} />
          ) : stock.isError ? (
            <ErrorState
              title={t('failed.title')}
              body={t('failed.body')}
              error={stock.error}
              onRetry={() => void stock.refetch()}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title={stock.data.rows.length === 0 ? t('stock.empty.title') : t('stock.noMatch')}
              body=""
              action={
                stock.data.rows.length === 0 && canManage ? (
                  <Button
                    variant="primary"
                    onClick={() => {
                      onSearch({ view: 'edit' });
                    }}
                  >
                    {t('stock.editItems')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            rows.map((row) => {
              const one = row.packSize ?? 1;
              return (
                <div
                  key={row.itemId}
                  role="row"
                  className={cn(
                    'grid min-h-12 cursor-pointer items-center gap-2.5 border-t border-row-divider px-3 text-[13px] hover:bg-faint',
                    !row.active && 'text-ink-muted',
                  )}
                  style={{ gridTemplateColumns: columns }}
                  onClick={() => {
                    onSearch({ item: row.itemId });
                  }}
                >
                  <span role="cell" className="min-w-0">
                    <span className="block truncate font-medium">{row.name}</span>
                    {row.code && (
                      <span className="block font-mono text-[11.5px] text-ink-muted">
                        {row.code}
                      </span>
                    )}
                  </span>
                  <span role="cell" className="truncate">
                    {categoryName(byCategory.get(row.categoryId))}
                  </span>
                  <span role="cell" className={cn(FIGURE, 'truncate')}>
                    {quantity(row.onHand, row)}
                  </span>
                  <span role="cell">
                    <StockLabel labels={row.labels} />
                  </span>
                  {canMoney && (
                    <span role="cell" dir="ltr" className={FIGURE}>
                      {row.value === null ? '—' : money(row.value)}
                    </span>
                  )}
                  <span
                    role="cell"
                    className="flex justify-end"
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    {canWrite && row.active && (
                      <Menu>
                        <MenuTrigger asChild>
                          <Button size="sm" busy={busy === row.itemId}>
                            {t('stock.takeOut')}
                          </Button>
                        </MenuTrigger>
                        <MenuContent>
                          <MenuItem onSelect={() => void run(row, one)}>
                            {row.packSize && row.packName
                              ? t('takeOut.one', { what: packWord(row.packName, 1) })
                              : t('takeOut.one', { what: unitWord(row.unit, 1) })}
                          </MenuItem>
                          <MenuItem
                            onSelect={() => {
                              onSearch({ item: row.itemId });
                            }}
                          >
                            {t('takeOut.other')}
                          </MenuItem>
                        </MenuContent>
                      </Menu>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </TableCard>
      {search.item && (
        <ItemPanel
          session={session}
          itemId={search.item}
          branchId={branchId}
          onClose={() => {
            onSearch({ item: undefined });
          }}
        />
      )}
      {panel === 'takeOut' && (
        <TakeOutPanel
          branchId={branchId}
          rows={stock.data?.rows ?? []}
          onClose={() => {
            setPanel(undefined);
          }}
        />
      )}
      {panel === 'categories' && (
        <CategoriesPanel
          onClose={() => {
            setPanel(undefined);
          }}
        />
      )}
      {panel === 'settings' && (
        <SettingsPanel
          onClose={() => {
            setPanel(undefined);
          }}
        />
      )}
    </>
  );
}

/** `1 receipt to price`, beside every value (Part E). */
export function UnpricedNote({
  unpriced,
}: {
  unpriced: { receipts: number; openingBatches: number } | null;
}) {
  const { t } = useInventoryWords();
  if (!unpriced || (unpriced.receipts === 0 && unpriced.openingBatches === 0)) return null;
  return (
    <span className="text-[12.5px] text-warning">
      {[
        unpriced.receipts > 0 ? t('unpriced.receipts', { count: unpriced.receipts }) : null,
        unpriced.openingBatches > 0
          ? t('unpriced.opening', { count: unpriced.openingBatches })
          : null,
      ]
        .filter(Boolean)
        .join(' · ')}
    </span>
  );
}
