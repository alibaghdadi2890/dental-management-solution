import type { Session } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChipCheckboxGroup } from '@/components/ui/chip-checkbox';
import {
  EmptyState,
  ErrorState,
  Pill,
  SkeletonRows,
  TableCard,
  TableHead,
} from '@/components/ui/list';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatDateTime, formatMoney } from '@/lib/format';
import { categoriesQuery, countsQuery, invalidateInventory, startCount } from './inventory-api';
import { BranchSwitch } from './inventory-page';
import type { InventorySearch } from './inventory-search';
import { useInventoryWords } from './inventory-words';

/** Counts (B5): the open count first, then the past ones with their differences. */
export function CountsTab({
  session,
  branchId,
  onSearch,
}: {
  session: Session;
  branchId: string;
  onSearch: (next: Partial<InventorySearch>) => void;
}) {
  const { t, locale } = useInventoryWords();
  const navigate = useNavigate();
  const canManage = usePermission('inventory:manage');
  const canMoney = usePermission('inventory:money_read');
  const [starting, setStarting] = useState(false);
  const counts = useQuery(countsQuery(branchId));
  const tenant = session.tenant;
  if (!tenant) return null;
  const rows = counts.data?.items ?? [];
  const open = rows.find((row) => row.status === 'open');
  const columns = canMoney
    ? 'minmax(180px,1.4fr) 120px 110px 110px 130px'
    : 'minmax(180px,1.4fr) 120px 110px 110px';
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
        {canManage && !open && (
          <Button
            variant="primary"
            className="ms-auto"
            onClick={() => {
              setStarting(true);
            }}
          >
            {t('counts.start')}
          </Button>
        )}
      </div>
      <TableCard minWidth={canMoney ? 700 : 580}>
        <div role="table" aria-label={t('tabs.counts')}>
          <TableHead
            columns={columns}
            labels={[
              t('counts.columns.started'),
              t('counts.columns.status'),
              t('counts.columns.counted'),
              t('counts.columns.differences'),
              ...(canMoney ? [t('counts.columns.value')] : []),
            ]}
          />
          {counts.isPending ? (
            <SkeletonRows columns={columns} label={t('loading')} />
          ) : counts.isError ? (
            <ErrorState
              title={t('failed.title')}
              body={t('failed.body')}
              error={counts.error}
              onRetry={() => void counts.refetch()}
            />
          ) : rows.length === 0 ? (
            <EmptyState title={t('counts.empty')} body="" />
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                role="row"
                className="grid min-h-11 cursor-pointer items-center gap-2.5 border-t border-row-divider px-3 text-[13px] hover:bg-faint"
                style={{ gridTemplateColumns: columns }}
                onClick={() => {
                  void navigate({ to: '/inventory/counts/$countId', params: { countId: row.id } });
                }}
              >
                <span role="cell">
                  {formatDateTime(row.startedAt, { timeZone: tenant.timeZone, locale })}
                  {row.startedByName && (
                    <span className="ms-2 text-ink-muted">{row.startedByName}</span>
                  )}
                </span>
                <span role="cell">
                  <Pill
                    tone={
                      row.status === 'open'
                        ? 'indigo'
                        : row.status === 'applied'
                          ? 'success'
                          : 'neutral'
                    }
                  >
                    {t(`counts.status.${row.status}`)}
                  </Pill>
                </span>
                <span role="cell" className="tabular-nums">
                  {row.countedCount}/{row.lineCount}
                </span>
                <span role="cell" className="tabular-nums">
                  {row.differenceCount}
                </span>
                {canMoney && (
                  <span role="cell" dir="ltr" className="font-mono tabular-nums">
                    {row.differenceValue === null
                      ? '—'
                      : formatMoney(
                          { amount: row.differenceValue, currency: tenant.currency },
                          locale,
                        )}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </TableCard>
      {starting && (
        <StartCountPanel
          branchId={branchId}
          onClose={() => {
            setStarting(false);
          }}
          onStarted={(countId) => {
            void navigate({ to: '/inventory/counts/$countId', params: { countId } });
          }}
        />
      )}
    </>
  );
}

function StartCountPanel({
  branchId,
  onClose,
  onStarted,
}: {
  branchId: string;
  onClose: () => void;
  onStarted: (countId: string) => void;
}) {
  const { t, i18n, categoryName } = useInventoryWords();
  const queryClient = useQueryClient();
  const toast = useToast();
  const categories = useQuery(categoriesQuery());
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const start = async () => {
    setSaving(true);
    try {
      const count = await startCount({ branchId, categoryIds: chosen });
      await invalidateInventory(queryClient);
      onStarted(count.id);
    } catch (error) {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
      />
      <RightPanel
        modal
        title={t('counts.start')}
        dirty={false}
        onClose={onClose}
        className="fixed inset-y-0 end-0 z-40 max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
        footer={
          <>
            <Button onClick={onClose}>{t('cancel')}</Button>
            <Button variant="primary" busy={saving} onClick={() => void start()}>
              {chosen.length === 0
                ? t('counts.startAll')
                : t('counts.startChosen', { count: chosen.length })}
            </Button>
          </>
        }
      >
        <ChipCheckboxGroup
          label={t('counts.categories')}
          options={(categories.data ?? [])
            .filter((row) => row.active)
            .map((row) => ({ value: row.id, label: categoryName(row) }))}
          selected={chosen}
          onToggle={(value) => {
            setChosen((current) =>
              current.includes(value) ? current.filter((id) => id !== value) : [...current, value],
            );
          }}
        />
      </RightPanel>
    </>
  );
}
