import type { ReorderList, Session } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/list';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { apiErrorMessage } from '@/lib/api-error-message';
import { todayIn } from '@/lib/format';
import { invalidateInventory, markOrderedMany, reorderQuery } from './inventory-api';
import { useInventoryWords } from './inventory-words';
import { QuantityInput } from './quantity-input';
import { type QuantityValue, unitsOf } from './quantities';

type Group = ReorderList['groups'][number];

/**
 * The reorder list (B7): the branch's low and out items not marked ordered, by usual supplier,
 * each with the usual order quantity, editable. It prints, copies as text or opens the mail
 * application — never with prices — and _Mark ordered_ works per supplier. The system sends
 * nothing.
 */
export function ReorderView({
  session,
  branchId,
  onBack,
}: {
  session: Session;
  branchId: string;
  onBack: () => void;
}) {
  const { t } = useInventoryWords();
  const list = useQuery(reorderQuery(branchId));
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        <Button size="sm" variant="ghost" onClick={onBack}>
          {t('back')}
        </Button>
        <h2 className="m-0 text-[15px] font-semibold">{t('reorder.title')}</h2>
        <Button
          className="ms-auto"
          onClick={() => {
            window.print();
          }}
        >
          {t('print')}
        </Button>
      </div>
      {list.isPending ? (
        <SkeletonRows columns="1fr 1fr 1fr" label={t('loading')} />
      ) : list.isError ? (
        <ErrorState
          title={t('failed.title')}
          body={t('failed.body')}
          error={list.error}
          onRetry={() => void list.refetch()}
        />
      ) : list.data.groups.length === 0 ? (
        <EmptyState title={t('reorder.empty')} body="" />
      ) : (
        <div className="flex flex-col gap-4">
          {list.data.groups.map((group) => (
            <GroupCard
              key={group.supplierId ?? 'none'}
              group={group}
              branchId={branchId}
              timeZone={session.tenant?.timeZone ?? 'UTC'}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function GroupCard({
  group,
  branchId,
  timeZone,
}: {
  group: Group;
  branchId: string;
  timeZone: string;
}) {
  const { t, i18n, quantity } = useInventoryWords();
  const queryClient = useQueryClient();
  const toast = useToast();
  const canManage = usePermission('inventory:manage');
  const [amounts, setAmounts] = useState<Record<string, QuantityValue>>(() =>
    Object.fromEntries(
      group.items.map((item) => [
        item.itemId,
        {
          text: item.proposed === null ? '' : String(item.proposed),
          mode: item.packSize ? 'pack' : 'unit',
        },
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const name = group.supplierName ?? t('reorder.noSupplier');
  const text = [
    name,
    ...group.items.map((item) => {
      const amount = amounts[item.itemId];
      const units = amount ? unitsOf(amount, item) : null;
      return `- ${item.name}${item.code ? ` (${item.code})` : ''}: ${units === null ? '—' : quantity(units, item)}`;
    }),
  ].join('\n');

  const markAll = async () => {
    setBusy(true);
    try {
      await markOrderedMany({
        branchId,
        itemIds: group.items.map((item) => item.itemId),
        orderedOn: todayIn(timeZone),
        note: null,
      });
      await invalidateInventory(queryClient);
      toast(t('reorder.marked', { name }), { tone: 'success' });
    } catch (error) {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface break-inside-avoid">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-faint px-4 py-2.5">
        <h3 className="m-0 flex-1 text-[13.5px] font-semibold">{name}</h3>
        <div className="flex gap-2 print:hidden">
          <Button
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(text).then(() => {
                toast(t('reorder.copied'), { tone: 'success' });
              });
            }}
          >
            {t('reorder.copy')}
          </Button>
          {group.email && (
            <a
              className="inline-flex h-[30px] items-center rounded-lg border border-border-control px-3 text-[12.5px] font-medium hover:border-ink"
              href={`mailto:${group.email}?subject=${encodeURIComponent(t('reorder.subject'))}&body=${encodeURIComponent(text)}`}
            >
              {t('reorder.email')}
            </a>
          )}
          {canManage && (
            <Button size="sm" variant="primary" busy={busy} onClick={() => void markAll()}>
              {t('item.markOrdered')}
            </Button>
          )}
        </div>
      </header>
      <ul className="m-0 list-none p-0">
        {group.items.map((item) => (
          <li
            key={item.itemId}
            className="grid grid-cols-[1.4fr_1fr_1fr] items-center gap-3 border-t border-row-divider px-4 py-2 text-[13px] first:border-t-0"
          >
            <span className="min-w-0 truncate font-medium">
              {item.name}
              {item.code && (
                <span className="ms-2 font-mono text-[11.5px] text-ink-muted">{item.code}</span>
              )}
            </span>
            <span className="font-mono text-ink-secondary tabular-nums">
              {quantity(item.onHand, item)}
            </span>
            <QuantityInput
              item={item}
              label={t('reorder.order', { item: item.name })}
              value={amounts[item.itemId] ?? { text: '', mode: 'pack' }}
              onChange={(value) => {
                setAmounts((current) => ({ ...current, [item.itemId]: value }));
              }}
            />
          </li>
        ))}
      </ul>
    </article>
  );
}
