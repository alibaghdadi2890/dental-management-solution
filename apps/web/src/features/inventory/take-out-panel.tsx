import type { StockRow } from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { Select, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatDayMonth } from '@/lib/format';
import { invalidateInventory, takeOut } from './inventory-api';
import { useInventoryWords } from './inventory-words';
import { QuantityInput } from './quantity-input';
import { emptyQuantity, type QuantityValue, unitsOf } from './quantities';
import { useUndoTakeOut } from './use-undo-take-out';

interface Line {
  key: string;
  itemId: string;
  amount: QuantityValue;
  note: string;
}

const blankLine = (): Line => ({
  key: crypto.randomUUID(),
  itemId: '',
  amount: { text: '', mode: 'unit' },
  note: '',
});

/**
 * The longer take-out form (B3): several items, any quantity, a note each, in one step. Opened
 * from the search (S8) it starts on `initialItemId` with one of its packs (or units), the
 * quantity in focus, so Enter takes that out.
 */
export function TakeOutPanel({
  branchId,
  rows,
  initialItemId,
  onClose,
}: {
  branchId: string;
  rows: readonly StockRow[];
  initialItemId?: string;
  onClose: () => void;
}) {
  const { t, i18n, locale, quantity } = useInventoryWords();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const undo = useUndoTakeOut();
  const [initial] = useState<Line[]>(() => {
    const chosen = rows.find((row) => row.itemId === initialItemId);
    return chosen
      ? [{ ...blankLine(), itemId: chosen.itemId, amount: { ...emptyQuantity(chosen), text: '1' } }]
      : [blankLine()];
  });
  const [lines, setLines] = useState<Line[]>(initial);
  const firstQuantityId = useId();
  // After the panel's own focus (its first field): the chosen item's quantity, selected.
  useEffect(() => {
    if (initial[0]?.itemId === '') return;
    const field = document.getElementById(firstQuantityId);
    if (field instanceof HTMLInputElement) {
      field.focus();
      field.select();
    }
  }, [initial, firstQuantityId]);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [requestKey] = useState(() => crypto.randomUUID());
  const offered = rows.filter((row) => row.active && row.onHand > 0);
  const rowOf = (itemId: string) => rows.find((row) => row.itemId === itemId);
  const filled = lines.filter((line) => line.itemId !== '');
  const valid =
    filled.length > 0 && filled.every((line) => unitsOf(line.amount, rowOf(line.itemId)) !== null);
  const patch = (key: string, next: Partial<Line>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...next } : line)));
  };

  const submit = async (allowExpired = false): Promise<void> => {
    setTried(true);
    if (!valid) return;
    setSaving(true);
    try {
      const result = await takeOut(
        {
          branchId,
          items: filled.map((line) => ({
            itemId: line.itemId,
            quantity: unitsOf(line.amount, rowOf(line.itemId)) as number,
            note: line.note.trim() || null,
          })),
          allowExpired,
        },
        allowExpired ? crypto.randomUUID() : requestKey,
      );
      await invalidateInventory(queryClient);
      const [only] = filled;
      const row = only && filled.length === 1 ? rowOf(only.itemId) : undefined;
      const units = only ? unitsOf(only.amount, row) : null;
      if (row && units !== null) {
        toast(t('takeOut.done', { what: quantity(units, row), item: row.name }), {
          tone: 'success',
          ...undo(result.movements[0]?.id),
        });
      } else {
        toast(t('takeOut.doneMany', { count: filled.length }), { tone: 'success' });
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'inventory.expired_batch') {
        confirm({
          title: t('takeOut.expiredTitle'),
          body: t('takeOut.expiredBody', {
            date: error.problem.expiresOn ? formatDayMonth(error.problem.expiresOn, locale) : '',
          }),
          okLabel: t('takeOut.anyway'),
          tone: 'warn',
          onConfirm: () => submit(true),
        });
      } else if (error instanceof ApiError && error.code === 'inventory.not_enough_stock') {
        const row = rowOf(error.problem.itemId ?? '');
        toast(
          t('takeOut.notEnoughOf', {
            item: row?.name ?? '',
            what: row ? quantity(error.problem.onHand ?? 0, row) : '',
          }),
          { tone: 'danger' },
        );
      } else {
        toast(apiErrorMessage(error, i18n), { tone: 'danger' });
      }
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
        title={t('takeOut.title')}
        dirty={lines !== initial && filled.length > 0}
        onClose={onClose}
        initialFocus="field"
        className="fixed inset-y-0 end-0 z-40 w-[560px] max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
        footer={
          <>
            <Button onClick={onClose}>{t('cancel')}</Button>
            <Button variant="primary" busy={saving} onClick={() => void submit()}>
              {t('takeOut.save')}
            </Button>
          </>
        }
      >
        <div
          className="flex flex-col gap-3 text-[13px]"
          onKeyDown={(event) => {
            // Enter in a quantity or a note takes out (S8: Enter takes out the box offered).
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            if (!(event.target instanceof HTMLInputElement) || saving) return;
            event.preventDefault();
            void submit();
          }}
        >
          {lines.map((line, index) => {
            const row = rowOf(line.itemId);
            const invalid = tried && line.itemId !== '' && unitsOf(line.amount, row) === null;
            return (
              <div key={line.key} className="grid grid-cols-[1.4fr_1fr_auto] items-start gap-2">
                <Select
                  aria-label={t('takeOut.item', { n: index + 1 })}
                  value={line.itemId}
                  onChange={(event) => {
                    patch(line.key, {
                      itemId: event.target.value,
                      amount: emptyQuantity(rowOf(event.target.value)),
                    });
                  }}
                >
                  <option value="">{t('takeOut.choose')}</option>
                  {offered.map((option) => (
                    <option key={option.itemId} value={option.itemId}>
                      {option.name}
                    </option>
                  ))}
                </Select>
                <QuantityInput
                  {...(index === 0 && { id: firstQuantityId })}
                  item={row}
                  value={line.amount}
                  invalid={invalid}
                  label={t('item.quantity')}
                  onChange={(amount) => {
                    patch(line.key, { amount });
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('remove')}
                  disabled={lines.length === 1}
                  onClick={() => {
                    setLines((current) => current.filter((other) => other.key !== line.key));
                  }}
                >
                  {'×'}
                </Button>
                <TextInput
                  className="col-span-2"
                  aria-label={t('item.note')}
                  placeholder={t('item.note')}
                  value={line.note}
                  maxLength={300}
                  onChange={(event) => {
                    patch(line.key, { note: event.target.value });
                  }}
                />
              </div>
            );
          })}
          <div>
            <Button
              size="sm"
              onClick={() => {
                setLines((current) => [...current, blankLine()]);
              }}
            >
              {t('takeOut.addLine')}
            </Button>
          </div>
        </div>
      </RightPanel>
    </>
  );
}
