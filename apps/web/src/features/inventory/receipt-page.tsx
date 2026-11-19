import {
  formatGoodsReceiptNumber,
  lineAmount,
  type PaymentMethod,
  type PricePer,
  type ReceiveRequest,
  RECEIPT_FILES_MAX,
  RECEIPT_FILE_TYPES,
  type Session,
  type StockReceipt,
} from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Page } from '@/components/page';
import { UnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { DateInput } from '@/components/ui/date-input';
import { Field, Select, TextInput } from '@/components/ui/field';
import { InfoMark } from '@/components/ui/info-mark';
import { ErrorState, Pill } from '@/components/ui/list';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { MoneyInput } from '@/features/billing/money-input';
import { MethodPicker } from '@/features/expenses/method-picker';
import { parseAmount } from '@/lib/amount';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { dateInputOrder, formatCalendarDate, formatMoney, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  attachFiles,
  editReceipt,
  invalidateInventory,
  itemsQuery,
  priceReceipt,
  receive,
  receiptFileUrl,
  receiptQuery,
  removeReceiptFile,
  suppliersQuery,
  voidReceipt,
} from './inventory-api';
import { useInventoryWords } from './inventory-words';
import { QuantityInput } from './quantity-input';
import { emptyQuantity, type QuantityValue, unitsOf } from './quantities';

type Tenant = NonNullable<Session['tenant']>;

interface DraftLine {
  key: string;
  itemId: string;
  amount: QuantityValue;
  price: string;
  pricePer: PricePer;
  lot: string;
  expiresOn: string;
}

const newLine = (): DraftLine => ({
  key: crypto.randomUUID(),
  itemId: '',
  amount: { text: '', mode: 'unit' },
  price: '',
  pricePer: 'unit',
  lot: '',
  expiresOn: '',
});

/** A receive input as the form holds it (D12: run b opens the form pre-filled from one). */
function linesFrom(draft: ReceiveRequest | undefined): DraftLine[] {
  if (!draft?.lines.length) return [newLine()];
  const drafted: DraftLine[] = draft.lines.map((line) => ({
    ...newLine(),
    itemId: line.itemId,
    amount: { text: String(line.quantity), mode: 'unit' },
    price: line.price ?? '',
    pricePer: line.pricePer ?? 'unit',
    lot: line.lot ?? '',
    expiresOn: line.expiresOn ?? '',
  }));
  return [...drafted, newLine()];
}

/**
 * Receiving a delivery (B1, its own page by the owner's answer): the supplier or a one-off
 * purchase's payee, the date, the invoice, the lines with lot and expiry, and for whoever manages
 * inventory money the prices, the discount, the tax and other charges and _Paid now_. Saving puts
 * the stock on hand at once; the invoice's photos upload after.
 */
export function ReceiveForm({
  session,
  branchId: initialBranch,
  draft,
  oneOff: startOneOff = false,
}: {
  session: Session;
  branchId: string;
  draft?: ReceiveRequest | undefined;
  /** Opened as a one-off purchase (Receipts' _One-off purchase_). */
  oneOff?: boolean;
}) {
  const { t, i18n, locale, packWord, unitWord } = useInventoryWords();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const canPrice = usePermission('inventory:money_manage');
  const items = useQuery(itemsQuery());
  const suppliers = useQuery(suppliersQuery());
  const tenant = session.tenant as Tenant;
  const today = todayIn(tenant.timeZone);
  const [branchId, setBranchId] = useState(draft?.branchId ?? initialBranch);
  const [oneOff, setOneOff] = useState(Boolean(draft?.payee) || startOneOff);
  const [supplierId, setSupplierId] = useState(draft?.supplierId ?? '');
  const [payee, setPayee] = useState(draft?.payee ?? '');
  const [receivedOn, setReceivedOn] = useState(draft?.receivedOn ?? today);
  const [invoiceNumber, setInvoiceNumber] = useState(draft?.invoiceNumber ?? '');
  const [invoiceDate, setInvoiceDate] = useState(draft?.invoiceDate ?? '');
  const [note, setNote] = useState(draft?.note ?? '');
  const [lines, setLines] = useState<DraftLine[]>(() => linesFrom(draft));
  const [discount, setDiscount] = useState(draft?.discount ?? '');
  const [charges, setCharges] = useState(draft?.charges ?? '');
  const [paidNow, setPaidNow] = useState(false);
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [reference, setReference] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const [touched, setTouched] = useState(false);

  const itemOf = (id: string) => items.data?.find((item) => item.id === id);
  const money = (amount: string) => formatMoney({ amount, currency: tenant.currency }, locale);
  const filled = lines.filter((line) => line.itemId !== '');
  const amountOf = (line: DraftLine) => {
    const item = itemOf(line.itemId);
    const units = unitsOf(line.amount, item);
    const price = parseAmount(line.price, locale);
    if (units === null || price === null || price === '') return null;
    return lineAmount(
      price,
      item?.packSize ? line.pricePer : 'unit',
      units,
      item?.packSize ?? null,
    );
  };
  const amounts = filled.map(amountOf);
  const allPriced = filled.length > 0 && amounts.every((amount) => amount !== null);
  const cents = (text: string) => {
    const parsed = parseAmount(text, locale);
    return parsed === null || parsed === '' ? 0 : Math.round(Number(parsed) * 100);
  };
  const totalCents = allPriced
    ? amounts.reduce((sum, amount) => sum + Math.round(Number(amount) * 100), 0) -
      cents(discount) +
      cents(charges)
    : null;
  const mustPay = oneOff || paidNow;

  const problems = {
    supplier: oneOff
      ? payee.trim() === ''
        ? t('form.payee')
        : undefined
      : supplierId === ''
        ? t('form.supplier')
        : undefined,
    lines: filled.length === 0 ? t('form.lines') : undefined,
    date: receivedOn === '' || receivedOn > today ? t('form.date') : undefined,
    pay: !mustPay
      ? undefined
      : !allPriced
        ? t('form.priceAll')
        : method === null
          ? t('form.method')
          : undefined,
  };
  const lineProblem = (line: DraftLine): string | undefined => {
    const item = itemOf(line.itemId);
    if (!item) return undefined;
    if (unitsOf(line.amount, item) === null) return t('form.quantity');
    if (item.tracksExpiry && line.expiresOn === '') return t('form.expiry');
    return undefined;
  };
  const ready =
    Object.values(problems).every((problem) => !problem) &&
    filled.every((line) => lineProblem(line) === undefined);

  const patchLine = (lineKey: string, next: Partial<DraftLine>) => {
    setTouched(true);
    setLines((current) =>
      current.map((line) => (line.key === lineKey ? { ...line, ...next } : line)),
    );
  };

  const submit = async (allowDuplicateInvoice = false): Promise<void> => {
    setTried(true);
    if (!ready || saving) return;
    setSaving(true);
    const optional = (text: string) => (text.trim() === '' ? null : text.trim());
    const body: ReceiveRequest = {
      supplierId: oneOff ? null : supplierId,
      payee: oneOff ? payee.trim() : null,
      branchId,
      receivedOn,
      invoiceNumber: optional(invoiceNumber),
      invoiceDate: optional(invoiceDate),
      note: optional(note),
      lines: filled.map((line) => {
        const item = itemOf(line.itemId);
        const price = canPrice ? parseAmount(line.price, locale) : null;
        return {
          itemId: line.itemId,
          quantity: unitsOf(line.amount, item) as number,
          price: price === '' ? null : price,
          pricePer: item?.packSize ? line.pricePer : 'unit',
          lot: optional(line.lot),
          expiresOn: optional(line.expiresOn),
        };
      }),
      discount: canPrice ? parseAmount(discount, locale) || null : null,
      charges: canPrice ? parseAmount(charges, locale) || null : null,
      paidNow: mustPay && method ? { paidOn, method, reference: optional(reference) } : null,
      allowDuplicateInvoice,
    };
    try {
      const saved = await receive(body, allowDuplicateInvoice ? crypto.randomUUID() : key);
      if (files.length > 0) {
        try {
          await attachFiles(saved.id, files);
        } catch (error) {
          toast(t('receipt.attachFailed'), { tone: 'danger', body: apiErrorMessage(error, i18n) });
        }
      }
      await invalidateInventory(queryClient);
      setTouched(false);
      toast(t('receipt.saved', { number: formatGoodsReceiptNumber(saved.number) }), {
        tone: 'success',
      });
      void navigate({ to: '/inventory/receipts/$receiptId', params: { receiptId: saved.id } });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'inventory.duplicate_invoice') {
        confirm({
          title: t('receipt.duplicateTitle'),
          body: t('receipt.duplicateBody', {
            number: formatGoodsReceiptNumber(error.problem.receiptNumber ?? 0),
          }),
          okLabel: t('receipt.saveAnyway'),
          tone: 'warn',
          onConfirm: () => submit(true),
        });
      } else {
        toast(apiErrorMessage(error, i18n), { tone: 'danger' });
      }
    } finally {
      setSaving(false);
    }
  };

  const shown = (problem: string | undefined) => (tried ? problem : undefined);
  const order = dateInputOrder(tenant.country);
  // Item · Quantity · (Price) · Lot · Expiry · (Amount) · remove.
  const lineColumns = canPrice
    ? 'minmax(220px,1.6fr) minmax(170px,1fr) minmax(170px,1fr) 120px 150px 110px 36px'
    : 'minmax(220px,1.6fr) minmax(170px,1fr) 140px 150px 36px';

  return (
    <Page title={oneOff ? t('receipt.oneOffTitle') : t('receipt.newTitle')}>
      <UnsavedChangesGuard when={touched && !saving} />
      <div className="flex max-w-[1100px] flex-col gap-5 text-[13px]">
        <section className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 rounded-xl border border-border bg-surface p-4">
          {canPrice && (
            <div role="group" aria-label={t('receipt.kind')} className="col-span-full flex gap-2">
              {[false, true].map((value) => (
                <Button
                  key={String(value)}
                  size="sm"
                  aria-pressed={oneOff === value}
                  variant={oneOff === value ? 'dark' : 'secondary'}
                  onClick={() => {
                    setOneOff(value);
                    setTouched(true);
                  }}
                >
                  {value ? t('receipt.oneOff') : t('receipt.fromSupplier')}
                </Button>
              ))}
            </div>
          )}
          {oneOff ? (
            <Field label={t('receipt.payee')} error={shown(problems.supplier)}>
              {(props) => (
                <TextInput
                  {...props}
                  value={payee}
                  maxLength={120}
                  onChange={(event) => {
                    setPayee(event.target.value);
                    setTouched(true);
                  }}
                />
              )}
            </Field>
          ) : (
            <Field label={t('receipt.supplier')} error={shown(problems.supplier)}>
              {(props) => (
                <Select
                  {...props}
                  value={supplierId}
                  onChange={(event) => {
                    setSupplierId(event.target.value);
                    setTouched(true);
                  }}
                >
                  <option value="">{t('takeOut.choose')}</option>
                  {(suppliers.data ?? []).map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {session.branches.length > 1 && (
            <Field label={t('branch')}>
              {(props) => (
                <Select
                  {...props}
                  value={branchId}
                  onChange={(event) => {
                    setBranchId(event.target.value);
                  }}
                >
                  {session.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label={t('receipt.receivedOn')} error={shown(problems.date)}>
            {(props) => (
              <DateInput
                {...props}
                value={receivedOn}
                onChange={setReceivedOn}
                order={order}
                today={today}
                pickerLabel={t('receipt.receivedOn')}
              />
            )}
          </Field>
          <Field label={t('receipt.invoiceNumber')}>
            {(props) => (
              <TextInput
                {...props}
                value={invoiceNumber}
                maxLength={60}
                onChange={(event) => {
                  setInvoiceNumber(event.target.value);
                  setTouched(true);
                }}
              />
            )}
          </Field>
          <Field label={t('receipt.invoiceDate')}>
            {(props) => (
              <DateInput
                {...props}
                value={invoiceDate}
                onChange={setInvoiceDate}
                order={order}
                today={today}
                pickerLabel={t('receipt.invoiceDate')}
              />
            )}
          </Field>
          <Field label={t('item.note')} className="col-span-full">
            {(props) => (
              <TextInput
                {...props}
                value={note}
                maxLength={500}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            )}
          </Field>
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="overflow-x-auto">
            <div
              role="table"
              aria-label={t('receipt.lines')}
              style={{ minWidth: canPrice ? 900 : 700 }}
            >
              <div
                role="row"
                className="grid h-10 items-center gap-2 border-b border-border bg-faint px-4"
                style={{ gridTemplateColumns: lineColumns }}
              >
                {[
                  t('receipt.item'),
                  t('item.quantity'),
                  ...(canPrice ? [t('receipt.price')] : []),
                  t('receipt.lot'),
                  t('receipt.expiry'),
                  ...(canPrice ? [t('receipt.amount')] : []),
                  '',
                ].map((label, index, all) => (
                  <span
                    key={index}
                    role="columnheader"
                    className={cn(
                      'text-[11.5px] leading-none font-medium tracking-[0.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal',
                      canPrice && index === all.length - 2 && 'text-end',
                    )}
                  >
                    {label}
                  </span>
                ))}
              </div>
              {lines.map((line, index) => {
                const item = itemOf(line.itemId);
                const problem = tried ? lineProblem(line) : undefined;
                const amount = amountOf(line);
                const last = index === lines.length - 1;
                return (
                  <div
                    key={line.key}
                    role="row"
                    className="grid items-start gap-2 border-t border-row-divider px-4 py-2.5 first:border-t-0"
                    style={{ gridTemplateColumns: lineColumns }}
                  >
                    <Select
                      aria-label={t('receipt.item')}
                      value={line.itemId}
                      onChange={(event) => {
                        const next = itemOf(event.target.value);
                        const amountValue = emptyQuantity(next);
                        patchLine(line.key, {
                          itemId: event.target.value,
                          amount: amountValue,
                          pricePer: amountValue.mode,
                        });
                        // A fresh line waits under the last one once it is used.
                        if (last && event.target.value !== '') {
                          setLines((current) => [...current, newLine()]);
                        }
                      }}
                    >
                      <option value="">{t('receipt.chooseItem')}</option>
                      {(items.data ?? [])
                        .filter((option) => option.active)
                        .map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                    </Select>
                    <QuantityInput
                      item={item}
                      value={line.amount}
                      label={t('item.quantity')}
                      invalid={problem === t('form.quantity')}
                      onChange={(amountValue) => {
                        // What the price is for follows what was counted: boxes at so much a box.
                        patchLine(line.key, { amount: amountValue, pricePer: amountValue.mode });
                      }}
                    />
                    {canPrice && (
                      <div className="flex h-9 items-center gap-1.5">
                        <MoneyInput
                          aria-label={t('receipt.price')}
                          value={line.price}
                          onChange={(price) => {
                            patchLine(line.key, { price });
                          }}
                          currency={tenant.currency}
                          locale={locale}
                        />
                        {item && (
                          <span className="flex-none text-[12px] whitespace-nowrap text-ink-muted">
                            {t('receipt.perWord', {
                              word:
                                item.packSize && item.packName && line.pricePer === 'pack'
                                  ? packWord(item.packName, 1)
                                  : unitWord(item.unit, 1),
                            })}
                          </span>
                        )}
                      </div>
                    )}
                    <TextInput
                      aria-label={t('receipt.lot')}
                      value={line.lot}
                      maxLength={40}
                      disabled={!item}
                      onChange={(event) => {
                        patchLine(line.key, { lot: event.target.value });
                      }}
                    />
                    <div>
                      {item?.tracksExpiry ? (
                        <>
                          <DateInput
                            aria-label={t('receipt.expiry')}
                            aria-invalid={problem === t('form.expiry')}
                            value={line.expiresOn}
                            onChange={(expiresOn) => {
                              patchLine(line.key, { expiresOn });
                            }}
                            order={order}
                            today={today}
                            max="2100-12-31"
                            pickerLabel={t('receipt.expiry')}
                          />
                          {line.expiresOn !== '' && line.expiresOn < today && (
                            <span className="mt-1 block text-[11.5px] font-medium text-warning">
                              {t('receipt.expired')}
                            </span>
                          )}
                          {problem === t('form.expiry') && (
                            <span className="mt-1 block text-[11.5px] font-medium text-danger">
                              {problem}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="flex h-9 items-center text-ink-muted">—</span>
                      )}
                    </div>
                    {canPrice && (
                      <span
                        dir="ltr"
                        className="flex h-9 items-center justify-end font-mono tabular-nums"
                      >
                        {amount === null ? '—' : money(amount)}
                      </span>
                    )}
                    <span className="flex h-9 items-center justify-center">
                      {line.itemId !== '' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t('remove')}
                          onClick={() => {
                            setLines((current) => {
                              const rest = current.filter((other) => other.key !== line.key);
                              return rest.length === 0 ? [newLine()] : rest;
                            });
                          }}
                        >
                          {'×'}
                        </Button>
                      )}
                    </span>
                  </div>
                );
              })}
              {canPrice && (
                <div
                  className="grid items-center gap-2 border-t border-border bg-faint px-4 py-2.5 text-[13px] font-medium"
                  style={{ gridTemplateColumns: lineColumns }}
                >
                  <span className="col-span-5">{t('receipt.linesTotal')}</span>
                  <span dir="ltr" className="text-end font-mono tabular-nums">
                    {filled.length === 0 || amounts.some((value) => value === null)
                      ? '—'
                      : money(
                          (
                            amounts.reduce(
                              (sum, value) => sum + Math.round(Number(value) * 100),
                              0,
                            ) / 100
                          ).toFixed(2),
                        )}
                  </span>
                  <span />
                </div>
              )}
            </div>
          </div>
          {shown(problems.lines) && (
            <p
              role="alert"
              className="m-0 border-t border-row-divider px-4 py-2 text-[12.5px] font-medium text-danger"
            >
              {problems.lines}
            </p>
          )}
        </section>

        {canPrice && (
          <section className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] items-end gap-4 rounded-xl border border-border bg-surface p-4">
            <Field
              label={t('receipt.discount')}
              info={
                <>
                  <InfoMark about={t('receipt.discount')}>{t('info.discount')}</InfoMark>
                </>
              }
            >
              {(props) => (
                <MoneyInput
                  {...props}
                  value={discount}
                  onChange={setDiscount}
                  currency={tenant.currency}
                  locale={locale}
                />
              )}
            </Field>
            <Field label={t('receipt.charges')}>
              {(props) => (
                <MoneyInput
                  {...props}
                  value={charges}
                  onChange={setCharges}
                  currency={tenant.currency}
                  locale={locale}
                />
              )}
            </Field>
            <div className="text-end">
              <span className="block text-[12px] text-ink-muted">{t('receipt.total')}</span>
              <span dir="ltr" className="font-mono text-[18px] font-semibold tabular-nums">
                {totalCents === null ? '—' : money((totalCents / 100).toFixed(2))}
              </span>
            </div>
            {!oneOff && (
              <label className="col-span-full flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={paidNow}
                  onChange={(event) => {
                    setPaidNow(event.target.checked);
                  }}
                />
                {t('receipt.paidNow')}
              </label>
            )}
            {mustPay && (
              <>
                <Field label={t('receipt.paidOn')}>
                  {(props) => (
                    <DateInput
                      {...props}
                      value={paidOn}
                      onChange={setPaidOn}
                      order={order}
                      today={today}
                      pickerLabel={t('receipt.paidOn')}
                    />
                  )}
                </Field>
                <div className="col-span-2">
                  <MethodPicker label={t('receipt.method')} value={method} onChange={setMethod} />
                </div>
                <Field label={t('receipt.reference')}>
                  {(props) => (
                    <TextInput
                      {...props}
                      value={reference}
                      maxLength={100}
                      onChange={(event) => {
                        setReference(event.target.value);
                      }}
                    />
                  )}
                </Field>
                {shown(problems.pay) && (
                  <p role="alert" className="col-span-full m-0 font-medium text-danger">
                    {problems.pay}
                  </p>
                )}
              </>
            )}
          </section>
        )}

        <FilePicker files={files} onChange={setFiles} />

        <div className="flex justify-end gap-2">
          <Link
            to="/inventory"
            search={{ tab: 'receipts' }}
            className="inline-flex h-9 items-center rounded-lg border border-border-control px-3.5 text-[12.5px] font-medium hover:border-ink"
          >
            {t('cancel')}
          </Link>
          <Button variant="primary" busy={saving} onClick={() => void submit()}>
            {t('receipt.save')}
          </Button>
        </div>
      </div>
    </Page>
  );
}

function FilePicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const { t } = useInventoryWords();
  return (
    <section className="rounded-xl border border-dashed border-border-strong bg-surface p-4">
      <label className="flex cursor-pointer flex-wrap items-center gap-3">
        <span className="font-medium">{t('receipt.attach')}</span>
        <input
          type="file"
          multiple
          accept={RECEIPT_FILE_TYPES.join(',')}
          className="text-[12.5px]"
          onChange={(event) => {
            const picked = [...(event.target.files ?? [])]
              .filter((file) => (RECEIPT_FILE_TYPES as readonly string[]).includes(file.type))
              .slice(0, RECEIPT_FILES_MAX);
            onChange(picked);
          }}
        />
      </label>
      {files.length > 0 && (
        <ul className="m-0 mt-2 list-none p-0 text-[12.5px] text-ink-secondary">
          {files.map((file) => (
            <li key={file.name}>{file.name}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A receipt (B1): its lines, what is left of each, its money for whoever sees it, its invoice
 * files; _Price_ for whoever manages inventory money, _Edit_ and _Void_ for whoever manages
 * inventory.
 */
export function ReceiptView({ session, receiptId }: { session: Session; receiptId: string }) {
  const { t, i18n, locale, quantity } = useInventoryWords();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const canWrite = usePermission('inventory:write');
  const canManage = usePermission('inventory:manage');
  const canMoney = usePermission('inventory:money_read');
  const canPrice = usePermission('inventory:money_manage');
  const receipt = useQuery(receiptQuery(receiptId));
  const [mode, setMode] = useState<'view' | 'price' | 'edit'>('view');
  const [files, setFiles] = useState<File[]>([]);
  const tenant = session.tenant as Tenant;
  if (receipt.isError) {
    return (
      <Page title={t('tabs.receipts')}>
        <ErrorState
          title={t('failed.title')}
          body={t('failed.body')}
          error={receipt.error}
          onRetry={() => void receipt.refetch()}
        />
      </Page>
    );
  }
  const data = receipt.data;
  if (!data) return <Page title={t('loading')} />;
  const money = (amount: string) => formatMoney({ amount, currency: data.currency }, locale);
  const live = data.voidedAt === null;
  const refresh = () => invalidateInventory(queryClient);
  const run = async (work: () => Promise<unknown>, done?: string) => {
    try {
      await work();
      await refresh();
      if (done) toast(done, { tone: 'success' });
      return true;
    } catch (error) {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
      return false;
    }
  };

  return (
    <Page
      title={`${formatGoodsReceiptNumber(data.number)} · ${data.supplierName ?? data.payee ?? ''}`}
      actions={
        <>
          <Link
            to="/inventory"
            search={{ tab: 'receipts' }}
            className="inline-flex h-9 items-center rounded-lg border border-border-control px-3.5 text-[12.5px] font-medium hover:border-ink"
          >
            {t('back')}
          </Link>
          {live && mode === 'view' && canPrice && data.supplierId !== null && (
            <Button
              variant={data.toPrice ? 'primary' : 'secondary'}
              onClick={() => {
                setMode('price');
              }}
            >
              {t('receipt.priceAction')}
            </Button>
          )}
          {live && mode === 'view' && canManage && (
            <Button
              onClick={() => {
                setMode('edit');
              }}
            >
              {t('receipt.edit')}
            </Button>
          )}
          {live && mode === 'view' && canManage && (
            <span className="flex items-center gap-1">
              <Button
                variant="danger"
                disabled={data.touched}
                onClick={() => {
                  confirm({
                    title: t('receipt.voidTitle'),
                    body: t('receipt.voidBody'),
                    okLabel: t('receipt.void'),
                    reasonLabel: t('history.reason'),
                    tone: 'danger',
                    onConfirm: async (reason) => {
                      await voidReceipt(receiptId, reason);
                      await refresh();
                    },
                  });
                }}
              >
                {t('receipt.void')}
              </Button>
              {data.touched && (
                <InfoMark about={t('receipt.void')}>{t('info.voidTouched')}</InfoMark>
              )}
            </span>
          )}
        </>
      }
    >
      <div className="flex max-w-[1100px] flex-col gap-4 text-[13px]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-ink-secondary">
          <span>{formatCalendarDate(data.receivedOn, locale)}</span>
          {data.invoiceNumber && (
            <span>{t('receipt.invoiceShort', { number: data.invoiceNumber })}</span>
          )}
          {data.invoiceDate && <span>{formatCalendarDate(data.invoiceDate, locale)}</span>}
          {session.branches.length > 1 && (
            <span>{session.branches.find((branch) => branch.id === data.branchId)?.name}</span>
          )}
          {data.createdByName && <span>{data.createdByName}</span>}
          {data.supplierId === null && <Pill tone="neutral">{t('receipt.oneOff')}</Pill>}
          {data.toPrice && live && <Pill tone="warning">{t('receipt.toPrice')}</Pill>}
          {!live && <Pill tone="neutral">{t('receipt.voided')}</Pill>}
        </div>
        {data.voidReason && <p className="m-0 text-ink-muted">{data.voidReason}</p>}
        {data.note && <p className="m-0">{data.note}</p>}

        {mode === 'price' ? (
          <PriceEditor
            receipt={data}
            tenant={tenant}
            onDone={() => {
              setMode('view');
            }}
          />
        ) : mode === 'edit' ? (
          <EditEditor
            receipt={data}
            tenant={tenant}
            onDone={() => {
              setMode('view');
            }}
          />
        ) : (
          <section className="overflow-hidden rounded-xl border border-border bg-surface">
            <ul className="m-0 list-none p-0">
              {data.lines.map((line) => (
                <li
                  key={line.batchId}
                  className="grid grid-cols-[minmax(180px,1.6fr)_minmax(150px,1fr)_110px_120px_120px] items-center gap-2 border-t border-row-divider px-4 py-2.5 first:border-t-0"
                >
                  <span className="truncate font-medium">{line.itemName}</span>
                  <span className="font-mono tabular-nums">
                    {quantity(line.quantity, line)}
                    {line.quantityLeft !== line.quantity && (
                      <span className="block text-[11.5px] text-ink-muted">
                        {t('receipt.left', { what: quantity(line.quantityLeft, line) })}
                      </span>
                    )}
                  </span>
                  <span className="truncate">{line.lot ?? '—'}</span>
                  <span>{line.expiresOn ? formatCalendarDate(line.expiresOn, locale) : '—'}</span>
                  <span dir="ltr" className="text-end font-mono tabular-nums">
                    {canMoney ? (line.amount === null ? '—' : money(line.amount)) : ''}
                  </span>
                </li>
              ))}
            </ul>
            {canMoney && (
              <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-t border-border bg-faint px-4 py-3 text-end">
                {data.discount && (
                  <>
                    <dt className="text-ink-muted">{t('receipt.discount')}</dt>
                    <dd dir="ltr" className="m-0 font-mono">
                      −{money(data.discount)}
                    </dd>
                  </>
                )}
                {data.charges && (
                  <>
                    <dt className="text-ink-muted">{t('receipt.charges')}</dt>
                    <dd dir="ltr" className="m-0 font-mono">
                      {money(data.charges)}
                    </dd>
                  </>
                )}
                <dt className="font-semibold">{t('receipt.total')}</dt>
                <dd dir="ltr" className="m-0 font-mono font-semibold">
                  {data.total === null ? t('receipt.toPrice') : money(data.total)}
                </dd>
              </dl>
            )}
          </section>
        )}

        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="m-0 mb-2 text-[12px] font-semibold">{t('receipt.files')}</h2>
          {data.files.length === 0 ? (
            <p className="m-0 text-ink-muted">—</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {data.files.map((file) => (
                <li key={file.id} className="flex items-center gap-2 py-1">
                  <span className="flex-1 truncate">{file.filename}</span>
                  {canMoney && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void receiptFileUrl(receiptId, file.id).then(({ url }) => {
                          window.open(url, '_blank', 'noopener');
                        })
                      }
                    >
                      {t('receipt.open')}
                    </Button>
                  )}
                  {canPrice && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void run(() => removeReceiptFile(receiptId, file.id))}
                    >
                      {t('remove')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canWrite && live && data.files.length < RECEIPT_FILES_MAX && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <FilePicker files={files} onChange={setFiles} />
              {files.length > 0 && (
                <Button
                  variant="primary"
                  onClick={() =>
                    void run(() => attachFiles(receiptId, files), t('receipt.attached')).then(
                      (done) => {
                        if (done) setFiles([]);
                      },
                    )
                  }
                >
                  {t('receipt.upload')}
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
    </Page>
  );
}

/** _Price_ (B1): what each line cost, per pack or per unit, the discount and the charges. */
function PriceEditor({
  receipt,
  tenant,
  onDone,
}: {
  receipt: StockReceipt;
  tenant: Tenant;
  onDone: () => void;
}) {
  const { t, i18n, locale, quantity, packWord, unitWord } = useInventoryWords();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [prices, setPrices] = useState<Record<string, { price: string; per: PricePer }>>(() =>
    Object.fromEntries(
      receipt.lines.map((line) => [
        line.batchId,
        { price: line.price ?? '', per: line.pricePer ?? (line.packSize ? 'pack' : 'unit') },
      ]),
    ),
  );
  const [discount, setDiscount] = useState(receipt.discount ?? '');
  const [charges, setCharges] = useState(receipt.charges ?? '');
  const [saving, setSaving] = useState(false);
  const money = (amount: string) => formatMoney({ amount, currency: tenant.currency }, locale);
  const amountOf = (batchId: string) => {
    const line = receipt.lines.find((candidate) => candidate.batchId === batchId);
    const entry = prices[batchId];
    const price = entry ? parseAmount(entry.price, locale) : null;
    if (!line || !entry || price === null || price === '') return null;
    return lineAmount(price, line.packSize ? entry.per : 'unit', line.quantity, line.packSize);
  };
  const amounts = receipt.lines.map((line) => amountOf(line.batchId));
  const cents = (text: string) => {
    const parsed = parseAmount(text, locale);
    return parsed === null || parsed === '' ? 0 : Math.round(Number(parsed) * 100);
  };
  const total = amounts.every((amount) => amount !== null)
    ? amounts.reduce((sum, amount) => sum + Math.round(Number(amount) * 100), 0) -
      cents(discount) +
      cents(charges)
    : null;

  const save = async () => {
    setSaving(true);
    try {
      await priceReceipt(receipt.id, {
        lines: receipt.lines.flatMap((line) => {
          const entry = prices[line.batchId];
          const price = entry ? parseAmount(entry.price, locale) : null;
          return entry && price !== null && price !== ''
            ? [{ batchId: line.batchId, price, pricePer: line.packSize ? entry.per : 'unit' }]
            : [];
        }),
        discount: parseAmount(discount, locale) || null,
        charges: parseAmount(charges, locale) || null,
      });
      await invalidateInventory(queryClient);
      onDone();
    } catch (error) {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-primary-tint-border bg-surface">
      <div className="grid h-10 grid-cols-[minmax(180px,1.6fr)_minmax(150px,1fr)_minmax(220px,1fr)_120px] items-center gap-2 border-b border-border bg-faint px-4 text-[11.5px] leading-none font-medium tracking-[0.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal">
        <span>{t('receipt.item')}</span>
        <span>{t('item.quantity')}</span>
        <span>{t('receipt.price')}</span>
        <span className="text-end">{t('receipt.amount')}</span>
      </div>
      <ul className="m-0 list-none p-0">
        {receipt.lines.map((line) => {
          const entry = prices[line.batchId] ?? { price: '', per: 'unit' as const };
          const amount = amountOf(line.batchId);
          return (
            <li
              key={line.batchId}
              className="grid grid-cols-[minmax(180px,1.6fr)_minmax(150px,1fr)_minmax(220px,1fr)_120px] items-center gap-2 border-t border-row-divider px-4 py-2.5 first:border-t-0"
            >
              <span className="truncate font-medium">{line.itemName}</span>
              <span className="font-mono tabular-nums">{quantity(line.quantity, line)}</span>
              <span className="flex gap-1">
                <MoneyInput
                  aria-label={t('receipt.price')}
                  value={entry.price}
                  onChange={(price) => {
                    setPrices((current) => ({ ...current, [line.batchId]: { ...entry, price } }));
                  }}
                  currency={tenant.currency}
                  locale={locale}
                />
                {line.packSize && (
                  <Select
                    aria-label={t('receipt.per')}
                    value={entry.per}
                    onChange={(event) => {
                      setPrices((current) => ({
                        ...current,
                        [line.batchId]: { ...entry, per: event.target.value as PricePer },
                      }));
                    }}
                    className="w-[110px]"
                  >
                    <option value="pack">
                      {t('receipt.perWord', { word: packWord(line.packName ?? '', 1) })}
                    </option>
                    <option value="unit">
                      {t('receipt.perWord', { word: unitWord(line.unit, 1) })}
                    </option>
                  </Select>
                )}
              </span>
              <span dir="ltr" className="text-end font-mono tabular-nums">
                {amount === null ? '—' : money(amount)}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] items-end gap-4 border-t border-border bg-faint px-4 py-3">
        <Field
          label={t('receipt.discount')}
          info={
            <>
              <InfoMark about={t('receipt.discount')}>{t('info.discount')}</InfoMark>
            </>
          }
        >
          {(props) => (
            <MoneyInput
              {...props}
              value={discount}
              onChange={setDiscount}
              currency={tenant.currency}
              locale={locale}
            />
          )}
        </Field>
        <Field label={t('receipt.charges')}>
          {(props) => (
            <MoneyInput
              {...props}
              value={charges}
              onChange={setCharges}
              currency={tenant.currency}
              locale={locale}
            />
          )}
        </Field>
        <div className="text-end">
          <span className="block text-[12px] text-ink-muted">{t('receipt.total')}</span>
          <span dir="ltr" className="font-mono text-[18px] font-semibold tabular-nums">
            {total === null ? '—' : money((total / 100).toFixed(2))}
          </span>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Button onClick={onDone}>{t('cancel')}</Button>
        <Button variant="primary" busy={saving} onClick={() => void save()}>
          {t('receipt.savePrices')}
        </Button>
      </div>
    </section>
  );
}

/** A quantity as typed in units. */
const unitsTyped = (quantity: number): QuantityValue => ({ text: String(quantity), mode: 'unit' });

/** _Edit_ (B1): the date, the invoice, the note, each line's lot, expiry and quantity. */
function EditEditor({
  receipt,
  tenant,
  onDone,
}: {
  receipt: StockReceipt;
  tenant: Tenant;
  onDone: () => void;
}) {
  const { t, i18n } = useInventoryWords();
  const queryClient = useQueryClient();
  const toast = useToast();
  const today = todayIn(tenant.timeZone);
  const order = dateInputOrder(tenant.country);
  const [receivedOn, setReceivedOn] = useState(receipt.receivedOn);
  const [invoiceNumber, setInvoiceNumber] = useState(receipt.invoiceNumber ?? '');
  const [invoiceDate, setInvoiceDate] = useState(receipt.invoiceDate ?? '');
  const [note, setNote] = useState(receipt.note ?? '');
  const [lines, setLines] = useState(() =>
    receipt.lines.map((line) => ({
      batchId: line.batchId,
      line,
      amount: unitsTyped(line.quantity),
      lot: line.lot ?? '',
      expiresOn: line.expiresOn ?? '',
    })),
  );
  const [saving, setSaving] = useState(false);
  const blank = (text: string) => (text.trim() === '' ? null : text.trim());
  const save = async () => {
    setSaving(true);
    try {
      await editReceipt(receipt.id, {
        receivedOn,
        invoiceNumber: blank(invoiceNumber),
        invoiceDate: blank(invoiceDate),
        note: blank(note),
        lines: lines.map((entry) => {
          const units = unitsOf(entry.amount, entry.line);
          return {
            batchId: entry.batchId,
            ...(units !== null && units !== entry.line.quantity ? { quantity: units } : {}),
            lot: blank(entry.lot),
            expiresOn: blank(entry.expiresOn),
          };
        }),
      });
      await invalidateInventory(queryClient);
      onDone();
    } catch (error) {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="rounded-xl border border-primary-tint-border bg-surface">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 p-4">
        <Field label={t('receipt.receivedOn')}>
          {(props) => (
            <DateInput
              {...props}
              value={receivedOn}
              onChange={setReceivedOn}
              order={order}
              today={today}
              pickerLabel={t('receipt.receivedOn')}
            />
          )}
        </Field>
        <Field label={t('receipt.invoiceNumber')}>
          {(props) => (
            <TextInput
              {...props}
              value={invoiceNumber}
              maxLength={60}
              onChange={(event) => {
                setInvoiceNumber(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t('receipt.invoiceDate')}>
          {(props) => (
            <DateInput
              {...props}
              value={invoiceDate}
              onChange={setInvoiceDate}
              order={order}
              today={today}
              pickerLabel={t('receipt.invoiceDate')}
            />
          )}
        </Field>
        <Field label={t('item.note')}>
          {(props) => (
            <TextInput
              {...props}
              value={note}
              maxLength={500}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      <ul className="m-0 list-none border-t border-border p-0">
        {lines.map((entry, index) => (
          <li
            key={entry.batchId}
            className="grid grid-cols-[minmax(180px,1.6fr)_minmax(150px,1fr)_130px_150px] items-start gap-2 border-t border-row-divider px-4 py-2.5 first:border-t-0"
          >
            <span className="truncate pt-2 font-medium">{entry.line.itemName}</span>
            <QuantityInput
              item={entry.line}
              value={entry.amount}
              label={t('item.quantity')}
              onChange={(amount) => {
                setLines((current) =>
                  current.map((other, at) => (at === index ? { ...other, amount } : other)),
                );
              }}
            />
            <TextInput
              aria-label={t('receipt.lot')}
              value={entry.lot}
              maxLength={40}
              onChange={(event) => {
                const lot = event.target.value;
                setLines((current) =>
                  current.map((other, at) => (at === index ? { ...other, lot } : other)),
                );
              }}
            />
            <DateInput
              aria-label={t('receipt.expiry')}
              value={entry.expiresOn}
              onChange={(expiresOn) => {
                setLines((current) =>
                  current.map((other, at) => (at === index ? { ...other, expiresOn } : other)),
                );
              }}
              order={order}
              today={today}
              max="2100-12-31"
              pickerLabel={t('receipt.expiry')}
            />
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Button onClick={onDone}>{t('cancel')}</Button>
        <Button variant="primary" busy={saving} onClick={() => void save()}>
          {t('save')}
        </Button>
      </div>
    </section>
  );
}
