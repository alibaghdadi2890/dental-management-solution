import {
  ADJUST_REASONS,
  type AdjustReason,
  type Batch,
  type Movement,
  type Session,
} from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { Eyebrow, Field, Select, TextInput } from '@/components/ui/field';
import { InfoMark } from '@/components/ui/info-mark';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { MoneyInput } from '@/features/billing/money-input';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { parseAmount } from '@/lib/amount';
import { formatCalendarDate, formatDayMonth, formatMoney, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  adjustStock,
  categoriesQuery,
  invalidateInventory,
  itemQuery,
  markOrdered,
  movementsQuery,
  priceBatch,
  reportCount,
  reverseMovement,
  setBranchLevel,
  takeOut,
  undoMovement,
  unmarkOrdered,
} from './inventory-api';
import { useInventoryWords } from './inventory-words';
import { QuantityInput } from './quantity-input';
import { emptyQuantity, type QuantityValue, unitsOf } from './quantities';
import { StockLabel } from './stock-label';

/**
 * An item's panel (C1): take out any quantity from a chosen batch, its batches in this branch,
 * what each branch holds, its reorder level here, _Mark ordered_, _Report wrong count_, and its
 * history (who, when, what, why) with _Undo_ and _Reverse_.
 */
export function ItemPanel({
  session,
  itemId,
  branchId,
  onClose,
}: {
  session: Session;
  itemId: string;
  branchId: string;
  onClose: () => void;
}) {
  const { t, i18n, locale, quantity, categoryName, packText, unitWord } = useInventoryWords();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const canWrite = usePermission('inventory:write');
  const canManage = usePermission('inventory:manage');
  const canMoneyManage = usePermission('inventory:money_manage');
  const detail = useQuery(itemQuery(itemId));
  const history = useQuery(movementsQuery({ itemId, branchId }));
  const categories = useQuery(categoriesQuery());
  const [amount, setAmount] = useState<QuantityValue>();
  const [batchId, setBatchId] = useState('');
  const [note, setNote] = useState('');
  const [adjusting, setAdjusting] = useState<Batch>();
  const [pricing, setPricing] = useState<Batch>();
  const [busy, setBusy] = useState(false);
  const tenant = session.tenant;
  if (!tenant) return null;
  const today = todayIn(tenant.timeZone);
  const data = detail.data;
  const item = data?.item;
  const here = data?.branches.find((branch) => branch.branchId === branchId);
  const batches = (data?.batches ?? []).filter((batch) => batch.branchId === branchId);
  const value = amount ?? emptyQuantity(item);
  const units = unitsOf(value, item);
  const money = (amountText: string) =>
    formatMoney({ amount: amountText, currency: tenant.currency }, locale);
  const branchName = (id: string) => session.branches.find((branch) => branch.id === id)?.name;

  const act = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await work();
      await invalidateInventory(queryClient);
      if (done) toast(done, { tone: 'success' });
    } catch (error) {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const submitTakeOut = async (allowExpired = false): Promise<void> => {
    if (!item || units === null) return;
    setBusy(true);
    try {
      await takeOut(
        {
          branchId,
          items: [
            {
              itemId,
              quantity: units,
              batchId: batchId || null,
              note: note.trim() || null,
            },
          ],
          allowExpired,
        },
        crypto.randomUUID(),
      );
      await invalidateInventory(queryClient);
      setAmount(emptyQuantity(item));
      setNote('');
      toast(t('takeOut.done', { what: quantity(units, item), item: item.name }), {
        tone: 'success',
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
          onConfirm: () => submitTakeOut(true),
        });
      } else if (error instanceof ApiError && error.code === 'inventory.not_enough_stock') {
        toast(t('takeOut.notEnough', { what: quantity(error.problem.onHand ?? 0, item) }), {
          tone: 'danger',
          actionLabel: t('takeOut.reportCount'),
          onAction: () => void act(() => reportCount(itemId, branchId), t('takeOut.reported')),
        });
      } else {
        toast(apiErrorMessage(error, i18n), { tone: 'danger' });
      }
    } finally {
      setBusy(false);
    }
  };

  const ordered = here?.orderedOn ?? null;

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
      />
      <RightPanel
        modal
        eyebrow={
          item ? categoryName(categories.data?.find((row) => row.id === item.categoryId)) : ''
        }
        title={item?.name ?? t('loading')}
        dirty={false}
        onClose={onClose}
        className="fixed inset-y-0 end-0 z-40 w-[520px] max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
      >
        {!data || !item ? (
          <p className="text-[13px] text-ink-muted">{t('loading')}</p>
        ) : (
          <div className="flex flex-col gap-5 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[18px] font-semibold tabular-nums">
                {quantity(here?.onHand ?? 0, item)}
              </span>
              <StockLabel labels={here?.labels ?? []} />
            </div>

            {canWrite && item.active && (
              <Section title={t('item.takeOut')}>
                <div className="grid grid-cols-[1fr_1fr] gap-2">
                  <QuantityInput
                    item={item}
                    value={value}
                    onChange={setAmount}
                    label={t('item.quantity')}
                  />
                  <Select
                    aria-label={t('item.batch')}
                    value={batchId}
                    onChange={(event) => {
                      setBatchId(event.target.value);
                    }}
                  >
                    <option value="">{t('item.firstToExpire')}</option>
                    {batches
                      .filter((batch) => batch.quantityLeft > 0)
                      .map((batch) => (
                        <option key={batch.id} value={batch.id}>
                          {batchText(batch)}
                        </option>
                      ))}
                  </Select>
                </div>
                <TextInput
                  className="mt-2"
                  aria-label={t('item.note')}
                  placeholder={t('item.note')}
                  value={note}
                  maxLength={300}
                  onChange={(event) => {
                    setNote(event.target.value);
                  }}
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="primary"
                    disabled={units === null}
                    busy={busy}
                    onClick={() => void submitTakeOut()}
                  >
                    {t('item.takeOutSave')}
                  </Button>
                </div>
              </Section>
            )}

            <Section title={t('item.batches')}>
              {batches.length === 0 ? (
                <p className="m-0 text-ink-muted">{t('item.noBatches')}</p>
              ) : (
                <ul className="m-0 list-none divide-y divide-row-divider p-0">
                  {batches.map((batch) => (
                    <li key={batch.id} className="flex items-center gap-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{batchText(batch)}</span>
                        <span className="block text-[11.5px] text-ink-muted">
                          {[
                            formatCalendarDate(batch.receivedOn, locale),
                            batch.receiptNumber !== null
                              ? `GR-${String(batch.receiptNumber).padStart(6, '0')}`
                              : t(`batchSource.${batch.source}`),
                            batch.priced ? null : t('item.toPrice'),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <span className="text-end font-mono tabular-nums">
                        {batch.quantityLeft}/{batch.quantity}
                        {batch.value !== null && (
                          <span dir="ltr" className="block text-[11.5px] text-ink-muted">
                            {money(batch.value)}
                          </span>
                        )}
                      </span>
                      {canManage && batch.quantityLeft > 0 && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setAdjusting(batch);
                          }}
                        >
                          {t('item.adjust')}
                        </Button>
                      )}
                      {canMoneyManage && !batch.priced && batch.source !== 'receipt' && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setPricing(batch);
                          }}
                        >
                          {t('item.setCost')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {session.branches.length > 1 && (
              <Section title={t('item.branches')}>
                <ul className="m-0 list-none p-0">
                  {data.branches.map((branch) => (
                    <li key={branch.branchId} className="flex items-center gap-2 py-1">
                      <span className="flex-1">{branchName(branch.branchId)}</span>
                      <span className="font-mono tabular-nums">
                        {quantity(branch.onHand, item)}
                      </span>
                      <StockLabel labels={branch.labels} />
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title={t('item.settings')}>
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                <dt className="flex items-center gap-1 text-ink-muted">
                  {t('item.unit')}
                  {item.moved && <InfoMark about={t('item.unit')}>{t('info.unitLocked')}</InfoMark>}
                </dt>
                <dd className="m-0">
                  {unitWord(item.unit, 1)}
                  {packText(item) && ` · ${packText(item) ?? ''}`}
                </dd>
                <dt className="text-ink-muted">{t('item.code')}</dt>
                <dd className="m-0 font-mono">{item.code ?? '—'}</dd>
                <dt className="text-ink-muted">{t('item.tracksExpiry')}</dt>
                <dd className="m-0">{item.tracksExpiry ? t('yes') : t('no')}</dd>
              </dl>
              <ReorderLevelField
                key={`${itemId}:${String(here?.ownReorderLevel)}`}
                itemLevel={item.reorderLevel}
                ownLevel={here?.ownReorderLevel ?? null}
                disabled={!canManage || busy}
                onSave={(level) =>
                  act(() => setBranchLevel(itemId, branchId, level), t('item.levelSaved'))
                }
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {canManage &&
                  (ordered ? (
                    <Button
                      size="sm"
                      onClick={() => void act(() => unmarkOrdered(itemId, branchId))}
                    >
                      {t('item.unmarkOrdered', { date: formatDayMonth(ordered, locale) })}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => {
                        // Ordered today, with an optional note (B6).
                        confirm({
                          title: t('item.markOrdered'),
                          body: item.name,
                          okLabel: t('item.markOrdered'),
                          reasonLabel: t('item.note'),
                          reasonOptional: true,
                          onConfirm: async (orderNote) => {
                            await markOrdered(itemId, branchId, {
                              orderedOn: today,
                              note: orderNote.trim() || null,
                            });
                            await invalidateInventory(queryClient);
                          },
                        });
                      }}
                    >
                      {t('item.markOrdered')}
                    </Button>
                  ))}
                {canWrite && !here?.toCount && (
                  <Button
                    size="sm"
                    onClick={() =>
                      void act(() => reportCount(itemId, branchId), t('takeOut.reported'))
                    }
                  >
                    {t('takeOut.reportCount')}
                  </Button>
                )}
              </div>
            </Section>

            <Section title={t('item.history')}>
              <History
                movements={history.data?.items ?? []}
                item={item}
                canManage={canManage}
                money={money}
                onUndo={(movement) =>
                  void act(() => undoMovement(movement.id), t('takeOut.undone'))
                }
                onReverse={(movement) => {
                  confirm({
                    title: t('history.reverseTitle'),
                    body: t('history.reverseBody', { what: quantity(-movement.quantity, item) }),
                    okLabel: t('history.reverse'),
                    reasonLabel: t('history.reason'),
                    tone: 'warn',
                    onConfirm: async (reason) => {
                      await reverseMovement(movement.id, reason);
                      await invalidateInventory(queryClient);
                    },
                  });
                }}
              />
            </Section>
          </div>
        )}
      </RightPanel>
      {adjusting && item && (
        <AdjustPanel
          batch={adjusting}
          itemId={itemId}
          branchId={branchId}
          units={item}
          title={batchText(adjusting)}
          onClose={() => {
            setAdjusting(undefined);
          }}
        />
      )}
      {pricing && item && (
        <BatchCostPanel
          batch={pricing}
          hasPack={item.packSize !== null}
          currency={tenant.currency}
          onClose={() => {
            setPricing(undefined);
          }}
        />
      )}
    </>
  );

  function batchText(batch: Batch): string {
    const parts = [
      batch.lot ? t('item.lot', { lot: batch.lot }) : null,
      batch.expiresOn
        ? t('item.expires', { date: formatCalendarDate(batch.expiresOn, locale) })
        : null,
    ].filter(Boolean);
    return parts.length === 0 ? formatCalendarDate(batch.receivedOn, locale) : parts.join(' · ');
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <Eyebrow className="mb-2">{title}</Eyebrow>
      {children}
    </section>
  );
}

function ReorderLevelField({
  itemLevel,
  ownLevel,
  disabled,
  onSave,
}: {
  itemLevel: number | null;
  ownLevel: number | null;
  disabled: boolean;
  onSave: (level: number | null) => void | Promise<void>;
}) {
  const { t } = useInventoryWords();
  const [text, setText] = useState(ownLevel === null ? '' : String(ownLevel));
  const parsed = text.trim() === '' ? null : /^\d{1,7}$/.test(text.trim()) ? Number(text) : NaN;
  return (
    <div className="mt-3 flex items-end gap-2">
      <Field label={t('item.reorderLevelHere')} className="flex-1">
        {(props) => (
          <TextInput
            {...props}
            inputMode="numeric"
            value={text}
            disabled={disabled}
            placeholder={itemLevel === null ? '—' : String(itemLevel)}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
        )}
      </Field>
      <Button
        disabled={disabled || Number.isNaN(parsed) || parsed === ownLevel}
        onClick={() => void onSave(Number.isNaN(parsed) ? null : parsed)}
      >
        {t('save')}
      </Button>
    </div>
  );
}

function History({
  movements,
  item,
  canManage,
  money,
  onUndo,
  onReverse,
}: {
  movements: readonly Movement[];
  item: { unit: string; packName: string | null; packSize: number | null };
  canManage: boolean;
  money: (amount: string) => string;
  onUndo: (movement: Movement) => void;
  onReverse: (movement: Movement) => void;
}) {
  const { t, locale, quantity } = useInventoryWords();
  if (movements.length === 0) return <p className="m-0 text-ink-muted">{t('history.empty')}</p>;
  return (
    <ul className="m-0 list-none divide-y divide-row-divider p-0">
      {movements.map((movement) => (
        <li key={movement.id} className={cn('py-2', movement.reversedAt && 'text-ink-muted')}>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">
              {t(`movement.${movement.kind}`)}
              {movement.reason &&
                movement.kind !== 'count' &&
                ` · ${t(`reason.${movement.reason}`)}`}
              {movement.receiptNumber !== null &&
                ` · GR-${String(movement.receiptNumber).padStart(6, '0')}`}
            </span>
            <span
              className={cn(
                'font-mono tabular-nums',
                movement.reversedAt && 'line-through',
                movement.quantity > 0 ? 'text-success' : undefined,
              )}
            >
              {movement.quantity > 0 ? '+' : '−'}
              {quantity(Math.abs(movement.quantity), item)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11.5px] text-ink-muted">
            <span className="flex-1 truncate">
              {[
                formatCalendarDate(movement.occurredOn, locale),
                movement.createdByName,
                movement.note,
                movement.cost !== null ? money(movement.cost.replace('-', '')) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {movement.canUndo && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onUndo(movement);
                }}
              >
                {t('takeOut.undo')}
              </Button>
            )}
            {!movement.canUndo &&
              canManage &&
              movement.kind === 'take_out' &&
              movement.reversedAt === null && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onReverse(movement);
                  }}
                >
                  {t('history.reverse')}
                </Button>
              )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** An adjustment or a write-off of one batch (B4): a reason; only a correction adds. */
function AdjustPanel({
  batch,
  itemId,
  branchId,
  units,
  title,
  onClose,
}: {
  batch: Batch;
  itemId: string;
  branchId: string;
  units: { unit: string; packName: string | null; packSize: number | null };
  title: string;
  onClose: () => void;
}) {
  const { t, i18n } = useInventoryWords();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState<AdjustReason>('expired');
  const [direction, setDirection] = useState<'remove' | 'add'>('remove');
  const [amount, setAmount] = useState<QuantityValue>(emptyQuantity(units));
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const count = unitsOf(amount, units);
  const adds = reason === 'correction' && direction === 'add';
  const problems = {
    quantity:
      count === null
        ? t('form.quantity')
        : !adds && count > batch.quantityLeft
          ? t('form.tooMany', { count: batch.quantityLeft })
          : undefined,
    note: reason === 'correction' && note.trim() === '' ? t('form.noteRequired') : undefined,
  };
  const submit = async () => {
    setTried(true);
    if (count === null || Object.values(problems).some(Boolean)) return;
    setSaving(true);
    try {
      await adjustStock(
        {
          branchId,
          itemId,
          batchId: batch.id,
          reason,
          quantity: adds ? count : -count,
          note: note.trim() || null,
        },
        key,
      );
      await invalidateInventory(queryClient);
      toast(t('adjust.saved'), { tone: 'success' });
      onClose();
    } catch (error) {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };
  return (
    <RightPanel
      modal
      eyebrow={title}
      title={t('adjust.title')}
      dirty={count !== null}
      onClose={onClose}
      initialFocus="field"
      className="fixed inset-y-0 end-0 z-50 max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" busy={saving} onClick={() => void submit()}>
            {t('adjust.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-[13px]">
        <Field
          label={t('adjust.reason')}
          info={
            <>
              {reason === 'returned' && (
                <InfoMark about={t('reason.returned')}>{t('info.returned')}</InfoMark>
              )}
            </>
          }
        >
          {(props) => (
            <Select
              {...props}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value as AdjustReason);
                if (event.target.value !== 'correction') setDirection('remove');
              }}
            >
              {ADJUST_REASONS.map((value) => (
                <option key={value} value={value}>
                  {t(`reason.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {reason === 'correction' && (
          <div role="group" aria-label={t('adjust.direction')} className="flex gap-2">
            {(['remove', 'add'] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={direction === value ? 'dark' : 'secondary'}
                aria-pressed={direction === value}
                onClick={() => {
                  setDirection(value);
                }}
              >
                {t(`adjust.${value}`)}
              </Button>
            ))}
          </div>
        )}
        <Field label={t('item.quantity')} error={tried ? problems.quantity : undefined}>
          {(props) => (
            <QuantityInput
              id={props.id}
              item={units}
              value={amount}
              onChange={setAmount}
              invalid={props['aria-invalid']}
            />
          )}
        </Field>
        <Field label={t('item.note')} error={tried ? problems.note : undefined}>
          {(props) => (
            <TextInput
              {...props}
              value={note}
              maxLength={300}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
    </RightPanel>
  );
}

/** The cost of opening stock entered without one (E), for whoever manages inventory money. */
function BatchCostPanel({
  batch,
  hasPack,
  currency,
  onClose,
}: {
  batch: Batch;
  hasPack: boolean;
  currency: string;
  onClose: () => void;
}) {
  const { t, i18n, locale } = useInventoryWords();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [per, setPer] = useState<'pack' | 'unit'>(hasPack ? 'pack' : 'unit');
  const [saving, setSaving] = useState(false);
  const price = parseAmount(text, locale);
  const submit = async () => {
    if (price === null || price === '' || price.startsWith('-')) return;
    setSaving(true);
    try {
      await priceBatch(batch.id, { price, pricePer: per });
      await invalidateInventory(queryClient);
      onClose();
    } catch (error) {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };
  return (
    <RightPanel
      modal
      title={t('item.setCost')}
      dirty={text !== ''}
      onClose={onClose}
      initialFocus="field"
      className="fixed inset-y-0 end-0 z-50 max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" busy={saving} onClick={() => void submit()}>
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="flex items-end gap-2 text-[13px]">
        <Field label={t('receipt.price')} className="flex-1">
          {(props) => (
            <MoneyInput
              {...props}
              value={text}
              onChange={setText}
              currency={currency}
              locale={locale}
            />
          )}
        </Field>
        {hasPack && (
          <Select
            aria-label={t('receipt.per')}
            value={per}
            onChange={(event) => {
              setPer(event.target.value as 'pack' | 'unit');
            }}
            className="w-28"
          >
            <option value="pack">{t('receipt.perPack')}</option>
            <option value="unit">{t('receipt.perUnit')}</option>
          </Select>
        )}
      </div>
    </RightPanel>
  );
}
