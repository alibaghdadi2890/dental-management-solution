import type { CountLine, PricePer, Session } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { DateInput } from '@/components/ui/date-input';
import { InfoMark } from '@/components/ui/info-mark';
import { ErrorState, Pill, SearchInput } from '@/components/ui/list';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { MoneyInput } from '@/features/billing/money-input';
import { parseAmount } from '@/lib/amount';
import { apiErrorMessage } from '@/lib/api-error-message';
import { dateInputOrder, formatMoney, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  applyCount,
  countQuery,
  discardCount,
  invalidateInventory,
  saveCountLine,
} from './inventory-api';
import { useInventoryWords } from './inventory-words';
import { matchesItem } from './item-match';

/**
 * A count sheet (B5, its own page by the owner's answer): each item with the system's quantity
 * and the counted one, saved as the user goes; it prints as a blank sheet. _Apply_ shows the
 * differences first. An item the branch never had takes its opening stock here (B8).
 */
export function CountPage({ session, countId }: { session: Session; countId: string }) {
  const { t, i18n, locale, quantity, unitWord } = useInventoryWords();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const canManage = usePermission('inventory:manage');
  const canMoney = usePermission('inventory:money_read');
  const count = useQuery(countQuery(countId));
  const [query, setQuery] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [applyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const tenant = session.tenant;
  if (!tenant) return null;
  if (count.isError) {
    return (
      <Page title={t('tabs.counts')}>
        <ErrorState
          title={t('failed.title')}
          body={t('failed.body')}
          error={count.error}
          onRetry={() => void count.refetch()}
        />
      </Page>
    );
  }
  const data = count.data;
  if (!data) return <Page title={t('loading')} />;
  const open = data.status === 'open' && canManage;
  const money = (amount: string) => formatMoney({ amount, currency: data.currency }, locale);
  const lines = data.lines.filter((line) => matchesItem(line, query));
  const differing = data.lines.filter((line) => line.difference !== null && line.difference !== 0);

  const apply = async () => {
    setBusy(true);
    try {
      await applyCount(countId, applyKey);
      await invalidateInventory(queryClient);
      setReviewing(false);
      toast(t('counts.applied'), { tone: 'success' });
    } catch (error) {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title={t('counts.title')}
      actions={
        <>
          <Link
            to="/inventory"
            search={{ tab: 'counts' }}
            className="inline-flex h-9 items-center rounded-lg border border-border-control px-3.5 text-[12.5px] font-medium hover:border-ink print:hidden"
          >
            {t('back')}
          </Link>
          <Button
            className="print:hidden"
            onClick={() => {
              window.print();
            }}
          >
            {t('counts.print')}
          </Button>
          {open && (
            <Button
              variant="danger"
              className="print:hidden"
              onClick={() => {
                confirm({
                  title: t('counts.discardTitle'),
                  body: t('counts.discardBody'),
                  okLabel: t('counts.discard'),
                  tone: 'danger',
                  onConfirm: async () => {
                    await discardCount(countId);
                    await invalidateInventory(queryClient);
                  },
                });
              }}
            >
              {t('counts.discard')}
            </Button>
          )}
          {open && (
            <Button
              variant="primary"
              className="print:hidden"
              disabled={data.countedCount === 0}
              onClick={() => {
                setReviewing(true);
              }}
            >
              {t('counts.apply')}
            </Button>
          )}
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px] print:hidden">
        <Pill
          tone={
            data.status === 'open' ? 'indigo' : data.status === 'applied' ? 'success' : 'neutral'
          }
        >
          {t(`counts.status.${data.status}`)}
        </Pill>
        <span className="text-ink-muted">
          {t('counts.progress', { counted: data.countedCount, total: data.lineCount })}
        </span>
        <InfoMark about={t('counts.title')}>{t('info.count')}</InfoMark>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t('filters.search')}
          label={t('filters.search')}
        />
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-faint text-start text-[11.5px] tracking-[0.05em] text-ink-muted uppercase">
              <th className="px-3 py-2.5 text-start font-medium">{t('stock.columns.item')}</th>
              <th className="px-3 py-2.5 text-start font-medium">{t('item.unit')}</th>
              <th className="px-3 py-2.5 text-end font-medium">{t('counts.system')}</th>
              <th className="px-3 py-2.5 text-start font-medium">{t('counts.counted')}</th>
              <th className="px-3 py-2.5 text-end font-medium print:hidden">
                {t('counts.difference')}
              </th>
              {canMoney && (
                <th className="px-3 py-2.5 text-end font-medium print:hidden">
                  {t('stock.columns.value')}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <CountRow
                key={line.itemId}
                line={line}
                countId={countId}
                editable={open}
                showMoney={canMoney}
                money={money}
                timeZone={tenant.timeZone}
                country={tenant.country}
                currency={data.currency}
                unitLabel={unitWord(line.unit, 2)}
                quantityText={(units) => quantity(units, line)}
              />
            ))}
          </tbody>
        </table>
      </div>
      {reviewing && (
        <>
          <div
            aria-hidden
            className="fixed inset-0 z-40 bg-[rgba(27,26,31,.28)]"
            onClick={() => {
              setReviewing(false);
            }}
          />
          <div
            role="dialog"
            aria-modal
            aria-label={t('counts.review')}
            className="fixed inset-x-0 top-1/2 z-50 mx-auto max-h-[80vh] w-[560px] max-w-[94vw] -translate-y-1/2 overflow-auto rounded-xl border border-border bg-surface p-5 text-[13px] shadow-xl"
          >
            <h2 className="m-0 mb-3 text-[15px] font-semibold">{t('counts.review')}</h2>
            {differing.length === 0 ? (
              <p className="m-0 text-ink-muted">{t('counts.noDifferences')}</p>
            ) : (
              <ul className="m-0 list-none divide-y divide-row-divider p-0">
                {differing.map((line) => (
                  <li key={line.itemId} className="flex items-center gap-3 py-2">
                    <span className="flex-1 truncate">{line.name}</span>
                    <span
                      className={cn(
                        'font-mono tabular-nums',
                        (line.difference ?? 0) > 0 ? 'text-success' : 'text-danger',
                      )}
                    >
                      {(line.difference ?? 0) > 0 ? '+' : '−'}
                      {quantity(Math.abs(line.difference ?? 0), line)}
                    </span>
                    {canMoney && (
                      <span dir="ltr" className="w-24 text-end font-mono tabular-nums">
                        {line.value === null ? '—' : money(line.value)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canMoney && data.differenceValue !== null && differing.length > 0 && (
              <p className="m-0 mt-3 text-end font-semibold">
                {t('counts.totalValue', { amount: money(data.differenceValue) })}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                onClick={() => {
                  setReviewing(false);
                }}
              >
                {t('cancel')}
              </Button>
              <Button variant="primary" busy={busy} onClick={() => void apply()}>
                {t('counts.apply')}
              </Button>
            </div>
          </div>
        </>
      )}
    </Page>
  );
}

function CountRow({
  line,
  countId,
  editable,
  showMoney,
  money,
  timeZone,
  country,
  currency,
  unitLabel,
  quantityText,
}: {
  line: CountLine;
  countId: string;
  editable: boolean;
  showMoney: boolean;
  money: (amount: string) => string;
  timeZone: string;
  country: string;
  currency: string;
  unitLabel: string;
  quantityText: (units: number) => string;
}) {
  const { t, i18n, locale } = useInventoryWords();
  const queryClient = useQueryClient();
  const toast = useToast();
  const canPrice = usePermission('inventory:money_manage');
  const [text, setText] = useState(line.counted === null ? '' : String(line.counted));
  const [price, setPrice] = useState(line.openingDetails?.price ?? '');
  const [per, setPer] = useState<PricePer>(
    line.openingDetails?.pricePer ?? (line.packSize ? 'pack' : 'unit'),
  );
  const [lot, setLot] = useState(line.openingDetails?.lot ?? '');
  const [expiresOn, setExpiresOn] = useState(line.openingDetails?.expiresOn ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle');
  const save = async () => {
    const counted = text.trim() === '' ? null : /^\d{1,7}$/.test(text.trim()) ? Number(text) : NaN;
    if (Number.isNaN(counted)) {
      setState('failed');
      return;
    }
    const parsedPrice = parseAmount(price, locale);
    setState('saving');
    try {
      await saveCountLine(countId, line.itemId, {
        counted,
        opening: line.opening
          ? {
              price: canPrice && parsedPrice ? parsedPrice : null,
              pricePer: per,
              lot: lot.trim() || null,
              expiresOn: expiresOn || null,
            }
          : null,
      });
      await queryClient.invalidateQueries({ queryKey: countQuery(countId).queryKey });
      setState('idle');
    } catch (error) {
      setState('failed');
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    }
  };
  return (
    <tr className="border-t border-row-divider align-top">
      <td className="px-3 py-2">
        <span className="block font-medium">{line.name}</span>
        {line.code && (
          <span className="block font-mono text-[11.5px] text-ink-muted">{line.code}</span>
        )}
        {line.opening && editable && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 print:hidden">
            <span className="text-[11.5px] text-ink-muted">{t('counts.opening')}</span>
            {canPrice && (
              <span className="flex w-[170px] gap-1">
                <MoneyInput
                  aria-label={t('receipt.price')}
                  value={price}
                  onChange={setPrice}
                  onBlur={() => void save()}
                  currency={currency}
                  locale={locale}
                />
                {line.packSize && (
                  <select
                    aria-label={t('receipt.per')}
                    value={per}
                    onChange={(event) => {
                      setPer(event.target.value as PricePer);
                    }}
                    className="rounded-md border border-border-control bg-surface text-[12px]"
                  >
                    <option value="pack">{t('receipt.perPack')}</option>
                    <option value="unit">{t('receipt.perUnit')}</option>
                  </select>
                )}
              </span>
            )}
            <input
              aria-label={t('receipt.lot')}
              placeholder={t('receipt.lot')}
              value={lot}
              maxLength={40}
              onChange={(event) => {
                setLot(event.target.value);
              }}
              onBlur={() => void save()}
              className="h-8 w-24 rounded-md border border-border-control px-2 text-[12px]"
            />
            {line.tracksExpiry && (
              <DateInput
                aria-label={t('receipt.expiry')}
                value={expiresOn}
                onChange={setExpiresOn}
                onBlur={() => void save()}
                order={dateInputOrder(country)}
                today={todayIn(timeZone)}
                max="2100-12-31"
                pickerLabel={t('receipt.expiry')}
                className="w-36"
              />
            )}
          </div>
        )}
      </td>
      <td className="px-3 py-2">{unitLabel}</td>
      <td className="px-3 py-2 text-end font-mono tabular-nums">{line.onHand}</td>
      <td className="px-3 py-2">
        {editable ? (
          <input
            inputMode="numeric"
            aria-label={t('counts.countedOf', { item: line.name })}
            aria-invalid={state === 'failed'}
            value={text}
            onChange={(event) => {
              setText(event.target.value.replace(/[^\d]/g, ''));
            }}
            onBlur={() => void save()}
            className={cn(
              'h-8 w-28 rounded-md border px-2 font-mono tabular-nums print:hidden',
              state === 'failed' ? 'border-danger' : 'border-border-control',
              state === 'saving' && 'opacity-60',
            )}
          />
        ) : (
          <span className="font-mono tabular-nums print:hidden">{line.counted ?? '—'}</span>
        )}
        <span className="hidden h-6 w-28 border-b border-ink print:block" />
      </td>
      <td className="px-3 py-2 text-end font-mono tabular-nums print:hidden">
        {line.difference === null || line.difference === 0
          ? line.difference === 0
            ? '0'
            : ''
          : `${line.difference > 0 ? '+' : '−'}${quantityText(Math.abs(line.difference))}`}
      </td>
      {showMoney && (
        <td dir="ltr" className="px-3 py-2 text-end font-mono tabular-nums print:hidden">
          {line.value === null ? '' : money(line.value)}
        </td>
      )}
    </tr>
  );
}
