import type { ExpenseCategory, FixedItem, Session } from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { useToast } from '@/components/ui/toast-context';
import { formatMonth } from '@/features/compensation/months';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatMoney } from '@/lib/format';
import { ConfirmItemsDialog } from './confirm-items-dialog';
import { ExpensePanel } from './expense-panel';
import { invalidateExpenses, skipItem } from './expenses-api';
import { useCategoryName } from './expense-words';

type Tenant = NonNullable<Session['tenant']>;

/**
 * Waiting for confirmation (A3, A5): the fixed expenses' months nobody confirmed or skipped yet,
 * oldest first, with their month. They are not expenses and count in no total. Whoever may manage
 * expenses confirms one (the expense panel, pre-filled), several at once (each amount shown), or
 * skips one; whoever may only read sees the list.
 */
export function PendingList({
  items,
  tenant,
  session,
  categories,
  canManage,
}: {
  items: readonly FixedItem[];
  tenant: Tenant;
  session: Session;
  categories: readonly ExpenseCategory[];
  canManage: boolean;
}) {
  const { t, i18n } = useTranslation(['expenses', 'common']);
  const nameOf = useCategoryName();
  const locale = i18n.resolvedLanguage ?? 'en';
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<FixedItem>();
  const [batch, setBatch] = useState<readonly FixedItem[]>();
  const chosen = items.filter((item) => selected.has(item.id));
  const byId = new Map(categories.map((category) => [category.id, category]));

  const skip = (item: FixedItem) => {
    const month = formatMonth(item.month, locale);
    confirm({
      title: t('expenses:pending.skipTitle', { name: item.name, month }),
      body: t('expenses:pending.skipBody'),
      okLabel: t('expenses:pending.skipOk'),
      reasonLabel: t('expenses:pending.skipReason'),
      reasonOptional: true,
      onConfirm: async (reason) => {
        try {
          await skipItem(item.id, { reason: reason === '' ? null : reason });
        } catch (failure) {
          throw new Error(apiErrorMessage(failure, i18n), { cause: failure });
        }
        await invalidateExpenses(queryClient);
        toast(t('expenses:pending.skipped'), { tone: 'success' });
      },
    });
  };

  if (items.length === 0) {
    return <p className="m-0 px-[18px] py-4 text-[12.5px] text-ink-muted">{t('pending.empty')}</p>;
  }
  return (
    <>
      {canManage && chosen.length > 1 && (
        <div className="flex items-center justify-end gap-2 border-b border-row-divider px-[18px] py-2">
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setBatch(chosen);
            }}
          >
            {t('pending.confirmSelected', { count: chosen.length })}
          </Button>
        </div>
      )}
      <ul className="m-0 list-none p-0">
        {items.map((item) => {
          const month = formatMonth(item.month, locale);
          return (
            <li
              key={item.id}
              className="flex min-h-12 items-center gap-3 border-t border-row-divider px-[18px] py-2 first:border-t-0"
            >
              {canManage && (
                <input
                  type="checkbox"
                  aria-label={t('pending.select', { name: item.name, month })}
                  checked={selected.has(item.id)}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) next.add(item.id);
                    else next.delete(item.id);
                    setSelected(next);
                  }}
                  className="size-4 cursor-pointer accent-primary"
                />
              )}
              <span className="w-[120px] flex-none text-[12.5px] font-medium text-warning">
                {month}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px]">
                <span className="font-medium">{item.name}</span>
                {nameOf(byId.get(item.categoryId)) !== item.name && (
                  <span className="ms-2 text-ink-muted">{nameOf(byId.get(item.categoryId))}</span>
                )}
              </span>
              <span dir="ltr" className="font-mono text-[13px] tabular-nums">
                {formatMoney({ amount: item.amount, currency: item.currency }, locale)}
              </span>
              {canManage && (
                <span className="flex flex-none gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setConfirming(item);
                    }}
                  >
                    {t('pending.confirm')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      skip(item);
                    }}
                  >
                    {t('pending.skip')}
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {confirming && (
        <ExpensePanel
          mode={{ kind: 'confirm', item: confirming }}
          tenant={tenant}
          categories={categories}
          branches={session.branches}
          onClose={() => {
            setConfirming(undefined);
          }}
        />
      )}
      {batch && (
        <ConfirmItemsDialog
          items={batch}
          tenant={tenant}
          onClose={() => {
            setBatch(undefined);
            setSelected(new Set());
          }}
        />
      )}
    </>
  );
}
