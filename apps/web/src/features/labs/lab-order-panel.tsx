import {
  LAB_REMAKE_BORNE_BY,
  LAB_REMAKE_REASONS,
  LAB_SENT_VIA,
  type LabOrder,
  type LabRemakeBorneBy,
  type LabRemakeReason,
  type LabSentVia,
  type Session,
} from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Field, Select, TextInput } from '@/components/ui/field';
import { Pill } from '@/components/ui/list';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { MoneyInput } from '@/features/billing/money-input';
import { openPrintable } from '@/features/billing/payments-api';
import { parseAmount } from '@/lib/amount';
import { apiErrorMessage } from '@/lib/api-error-message';
import {
  dateInputOrder,
  formatCalendarDate,
  formatDateTime,
  formatMoney,
  todayIn,
} from '@/lib/format';
import { LabOrderLabelPill } from './lab-order-label';
import { orderNumber, slipText, useItemText } from './lab-words';
import {
  cancelLabOrder,
  expectLabOrder,
  holdLabOrder,
  invalidateLabs,
  labOrderQuery,
  labOutcome,
  labProposalQuery,
  linkLabOrder,
  receiveLabOrders,
  resumeLabOrder,
  sendLabOrder,
  undoLabOrder,
} from './labs-api';
import { NewLabOrderPanel } from './new-lab-order-panel';

type Tenant = NonNullable<Session['tenant']>;
type Action = 'send' | 'receive' | 'expected' | 'back' | 'remake' | 'hold' | 'cancel' | 'link';

/**
 * One lab order in a side panel (B1–B7): what it holds, its trips, attachments and appointment,
 * and the actions its status allows — each a short form inside the panel. Prices only with lab
 * money. Undo takes the last mark one step back.
 */
export function LabOrderPanel({
  orderId,
  session,
  onClose,
}: {
  orderId: string;
  session: Session;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['labs', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const order = useQuery(labOrderQuery(orderId));
  const canManage = usePermission('lab:manage');
  const canMoney = usePermission('lab:money_manage');
  const itemText = useItemText();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const tenant = session.tenant;
  const data = order.data;
  if (!tenant) return null;
  const date = (value: string | null) => (value ? formatCalendarDate(value, locale) : '—');

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      await invalidateLabs(queryClient);
      setAction(null);
      toast(t('labs:order.updated'), { tone: 'success' });
    } catch (failure) {
      toast(apiErrorMessage(failure, i18n), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const copyForEmail = async () => {
    if (!data) return;
    await navigator.clipboard.writeText(slipText(data, tenant, t, itemText, locale));
    toast(t('labs:order.copied'), { tone: 'success' });
  };

  const status = data?.status;
  const actions: { key: string; label: string; onClick: () => void; primary?: boolean }[] = [];
  if (data && canManage) {
    const open = (key: Action) => () => {
      setAction(key);
    };
    if (status === 'to_send' || status === 'remake') {
      actions.push({
        key: 'send',
        label: t('labs:order.actions.markSent'),
        onClick: open('send'),
        primary: true,
      });
    }
    if (status === 'at_lab') {
      actions.push(
        {
          key: 'receive',
          label: t('labs:order.actions.markReceived'),
          onClick: open('receive'),
          primary: true,
        },
        { key: 'expected', label: t('labs:order.actions.newExpected'), onClick: open('expected') },
      );
    }
    if (status === 'arrived') {
      actions.push(
        {
          key: 'fitted',
          label: t('labs:order.actions.fitted'),
          primary: true,
          onClick: () => void run(() => labOutcome(data.id, { choice: 'fitted' })),
        },
        { key: 'back', label: t('labs:order.actions.backToLab'), onClick: open('back') },
        { key: 'remake', label: t('labs:order.actions.remake'), onClick: open('remake') },
      );
    }
    if (status === 'to_send' || status === 'at_lab') {
      actions.push({ key: 'hold', label: t('labs:order.actions.hold'), onClick: open('hold') });
    }
    if (status === 'on_hold') {
      actions.push({
        key: 'resume',
        label: t('labs:order.actions.resume'),
        primary: true,
        onClick: () => void run(() => resumeLabOrder(data.id)),
      });
    }
    if (status !== 'done' && status !== 'cancelled') {
      actions.push(
        { key: 'link', label: t('labs:order.actions.link'), onClick: open('link') },
        {
          key: 'edit',
          label: t('labs:order.actions.edit'),
          onClick: () => {
            setEditing(true);
          },
        },
        { key: 'cancel', label: t('labs:order.actions.cancel'), onClick: open('cancel') },
      );
    }
    for (const step of data.undoable) {
      actions.push({
        key: `undo-${step}`,
        label: t(`labs:undo.${step}`),
        onClick: () => void run(() => undoLabOrder(data.id, step)),
      });
    }
  }

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
      />
      <RightPanel
        modal
        dirty={false}
        eyebrow={t('labs:order.eyebrow')}
        title={
          data
            ? t('labs:order.title', { number: orderNumber(data).slice(2), lab: data.labName })
            : '…'
        }
        onClose={onClose}
        className="fixed inset-y-0 end-0 z-40 max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
        footer={
          data ? (
            <>
              <Button
                onClick={() => {
                  openPrintable(`/print/lab-slip/${data.id}`);
                }}
              >
                {t('labs:order.actions.printSlip')}
              </Button>
              <Button onClick={() => void copyForEmail()}>
                {t('labs:order.actions.copyEmail')}
              </Button>
            </>
          ) : undefined
        }
      >
        {!data ? (
          <p className="text-[13px] text-ink-muted">
            {order.isError ? t('labs:errorBody') : t('labs:loading')}
          </p>
        ) : (
          <div className="flex flex-col gap-4 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              {data.label ? (
                <LabOrderLabelPill label={data.label} />
              ) : (
                <Pill tone="neutral">{t(`labs:status.${data.status}`)}</Pill>
              )}
              {data.priority === 'urgent' && (
                <Pill tone="warning">{t('labs:priority.urgent')}</Pill>
              )}
              <span className="text-ink-muted">{t(`labs:submission.${data.submission}`)}</span>
            </div>

            {actions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {actions.map((item) => (
                  <Button
                    key={item.key}
                    size="sm"
                    variant={item.primary ? 'primary' : 'outline'}
                    disabled={busy}
                    onClick={item.onClick}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            )}

            {action && (
              <ActionForm
                action={action}
                order={data}
                tenant={tenant}
                canMoney={canMoney}
                busy={busy}
                onCancel={() => {
                  setAction(null);
                }}
                onRun={(work) => void run(work)}
              />
            )}

            <Section title={t('labs:order.patient')}>
              <div className="font-medium">{data.patient.fullName}</div>
              <div className="text-ink-muted">{data.patient.displayNumber}</div>
            </Section>
            <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
              <Term label={t('labs:order.dentist')}>{data.dentistName}</Term>
              {data.visitNumber !== null && (
                <Term
                  label={t('labs:order.visit')}
                >{`V-${String(data.visitNumber).padStart(6, '0')}`}</Term>
              )}
              <Term label={t('labs:order.wait')}>
                {t('labs:order.waitDays', { count: data.expectedDays })}
              </Term>
              <Term label={t('labs:order.appointment')}>
                {data.appointment
                  ? formatDateTime(data.appointment.startsAt, { timeZone: tenant.timeZone, locale })
                  : t('labs:order.noAppointment')}
              </Term>
              {data.labCaseRef && <Term label={t('labs:order.caseRef')}>{data.labCaseRef}</Term>}
              {data.cost !== null && (
                <Term label={t('labs:order.cost')}>
                  <span dir="ltr" className="font-mono">
                    {formatMoney({ amount: data.cost, currency: data.currency }, locale)}
                  </span>
                  <span className="ms-1.5 text-ink-muted">
                    {data.costSetByHand ? t('labs:order.costByHand') : t('labs:order.costEstimate')}
                  </span>
                </Term>
              )}
            </dl>
            {data.labCaseUrl && (
              <a
                href={data.labCaseUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {t('labs:order.caseLink')}
              </a>
            )}

            <Section title={t('labs:order.items')}>
              <ul className="m-0 list-disc ps-5">
                {data.items.map((item) => (
                  <li key={item.id}>
                    {itemText(item)}
                    {item.unitPrice !== null && (
                      <span dir="ltr" className="ms-1.5 font-mono text-ink-muted">
                        {formatMoney({ amount: item.unitPrice, currency: data.currency }, locale)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>

            {data.notes && (
              <Section title={t('labs:order.notes')}>
                <p className="m-0 whitespace-pre-wrap">{data.notes}</p>
              </Section>
            )}

            <Section title={t('labs:order.trips')}>
              {data.trips.length === 0 ? (
                <p className="m-0 text-ink-muted">
                  {t('labs:order.waitDays', { count: data.expectedDays })}
                </p>
              ) : (
                <ol className="m-0 flex list-none flex-col gap-2 p-0">
                  {data.trips.map((trip) => (
                    <li key={trip.seq} className="rounded-md border border-border px-3 py-2">
                      <div className="font-medium">{t('labs:order.trip', { seq: trip.seq })}</div>
                      <div>
                        {t('labs:order.tripSent', {
                          date: date(trip.sentOn),
                          via: t(`labs:via.${trip.sentVia}`),
                        })}
                      </div>
                      <div className="text-ink-muted">
                        {t('labs:order.tripPromised', { date: date(trip.promisedOn) })}
                        {trip.expectedOn !== trip.promisedOn &&
                          ` · ${t('labs:order.tripExpected', { date: date(trip.expectedOn) })}`}
                      </div>
                      <div>
                        {trip.receivedOn
                          ? t('labs:order.tripReceived', { date: date(trip.receivedOn) })
                          : t('labs:order.tripWaiting')}
                      </div>
                      {trip.outcome && (
                        <div className="text-ink-muted">
                          {t('labs:order.tripOutcome', {
                            outcome: t(`labs:outcome.${trip.outcome}`),
                          })}
                          {trip.remakeReason &&
                            ` · ${t(`labs:remakeReason.${trip.remakeReason}`)} · ${t(`labs:borneBy.${trip.remakeBorneBy ?? 'lab'}`)}`}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </Section>

            <Section title={t('labs:order.attachments')}>
              {data.files.length === 0 ? (
                <p className="m-0 text-ink-muted">{t('labs:order.noAttachments')}</p>
              ) : (
                <ul className="m-0 list-disc ps-5">
                  {data.files.map((file) => (
                    <li key={file.id}>{file.originalFilename}</li>
                  ))}
                </ul>
              )}
            </Section>

            {data.status === 'cancelled' && data.cancelledOn && (
              <p className="m-0 text-ink-muted">
                {t('labs:order.cancelled', { date: date(data.cancelledOn) })} · {data.cancelReason}
                {data.cancelCharge !== null &&
                  ` · ${t('labs:order.cancelCharge', { amount: formatMoney({ amount: data.cancelCharge, currency: data.currency }, locale) })}`}
              </p>
            )}
            {data.doneOn && (
              <p className="m-0 text-ink-muted">
                {t('labs:order.doneOn', { date: date(data.doneOn) })}
              </p>
            )}
          </div>
        )}
      </RightPanel>
      {editing && data && (
        <NewLabOrderPanel
          session={session}
          editing={data}
          onClose={() => {
            setEditing(false);
          }}
          onCreated={() => {
            setEditing(false);
          }}
        />
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11.5px] font-medium tracking-[0.05em] text-ink-muted uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="m-0">{children}</dd>
    </>
  );
}

/** The short form of one action, inside the panel. */
function ActionForm({
  action,
  order,
  tenant,
  canMoney,
  busy,
  onCancel,
  onRun,
}: {
  action: Action;
  order: LabOrder;
  tenant: Tenant;
  canMoney: boolean;
  busy: boolean;
  onCancel: () => void;
  onRun: (work: () => Promise<unknown>) => void;
}) {
  const { t, i18n } = useTranslation(['labs', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const today = todayIn(tenant.timeZone);
  const [day, setDay] = useState(action === 'expected' ? (order.expectedOn ?? today) : today);
  const [via, setVia] = useState<LabSentVia>('courier');
  const [text, setText] = useState('');
  const [backKind, setBackKind] = useState<'next_stage' | 'adjustment'>('next_stage');
  const [reason, setReason] = useState<LabRemakeReason>('fit');
  const [borneBy, setBorneBy] = useState<LabRemakeBorneBy>('lab');
  const [amountText, setAmountText] = useState('');
  const [appointmentId, setAppointmentId] = useState(order.appointment?.id ?? '');
  const proposal = useQuery({
    ...labProposalQuery(order.patient.id, order.dentistId),
    enabled: action === 'link',
  });
  const amount = parseAmount(amountText, locale);
  const charged = order.tripCount > 0 && order.firstReceivedOn === null;
  const dateField = (label: string) => (
    <Field
      label={label}
      error={action !== 'expected' && day > today ? t('labs:dialogs.dateInFuture') : undefined}
    >
      {(props) => (
        <DateInput
          {...props}
          value={day}
          onChange={setDay}
          order={dateInputOrder(tenant.country)}
          today={today}
          max={action === 'expected' ? '2100-12-31' : today}
          pickerLabel={t('labs:dialogs.chooseDate')}
        />
      )}
    </Field>
  );
  const textField = (label: string, required = false) => (
    <Field label={label} hint={required ? undefined : t('labs:dialogs.optional')}>
      {(props) => (
        <TextInput
          {...props}
          value={text}
          maxLength={500}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      )}
    </Field>
  );
  const note = text.trim() === '' ? null : text.trim();
  const chargeField = (label: string, hint: string) => (
    <Field label={label} hint={hint}>
      {(props) => (
        <MoneyInput
          {...props}
          value={amountText}
          onChange={setAmountText}
          currency={order.currency}
          locale={locale}
        />
      )}
    </Field>
  );
  const money = typeof amount === 'string' && amount !== '' ? amount : null;

  let body: ReactNode = null;
  let submit: (() => Promise<unknown>) | null = null;
  switch (action) {
    case 'send':
      body = (
        <>
          {dateField(t('labs:dialogs.sentOn'))}
          <Field label={t('labs:dialogs.how')}>
            {(props) => (
              <Select
                {...props}
                value={via}
                onChange={(event) => {
                  setVia(event.target.value as LabSentVia);
                }}
              >
                {LAB_SENT_VIA.map((value) => (
                  <option key={value} value={value}>
                    {t(`labs:via.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {textField(t('labs:dialogs.reference'))}
        </>
      );
      submit = () => sendLabOrder(order.id, { sentOn: day, via, reference: note });
      break;
    case 'receive':
      body = (
        <>
          {dateField(t('labs:dialogs.receivedOn'))}
          {textField(t('labs:dialogs.note'))}
        </>
      );
      submit = () => receiveLabOrders({ orderIds: [order.id], receivedOn: day, note });
      break;
    case 'expected':
      body = (
        <>
          {dateField(t('labs:dialogs.expectedOn'))}
          {order.promisedOn && (
            <p className="m-0 text-[12.5px] text-ink-muted">
              {t('labs:dialogs.expectedHint', {
                date: formatCalendarDate(order.promisedOn, locale),
              })}
            </p>
          )}
        </>
      );
      submit = () => expectLabOrder(order.id, day);
      break;
    case 'back':
      body = (
        <>
          <Field label={t('labs:dialogs.backKind')}>
            {(props) => (
              <Select
                {...props}
                value={backKind}
                onChange={(event) => {
                  setBackKind(event.target.value as 'next_stage' | 'adjustment');
                }}
              >
                <option value="next_stage">{t('labs:outcome.next_stage')}</option>
                <option value="adjustment">{t('labs:outcome.adjustment')}</option>
              </Select>
            )}
          </Field>
          {textField(t('labs:dialogs.note'))}
        </>
      );
      submit = () => labOutcome(order.id, { choice: backKind, note });
      break;
    case 'remake':
      body = (
        <>
          <Field label={t('labs:dialogs.reason')}>
            {(props) => (
              <Select
                {...props}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value as LabRemakeReason);
                }}
              >
                {LAB_REMAKE_REASONS.map((value) => (
                  <option key={value} value={value}>
                    {t(`labs:remakeReason.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('labs:dialogs.borneBy')}>
            {(props) => (
              <Select
                {...props}
                value={borneBy}
                onChange={(event) => {
                  setBorneBy(event.target.value as LabRemakeBorneBy);
                }}
              >
                {LAB_REMAKE_BORNE_BY.map((value) => (
                  <option key={value} value={value}>
                    {t(`labs:borneBy.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {borneBy === 'clinic' &&
            canMoney &&
            chargeField(t('labs:dialogs.charge'), t('labs:dialogs.chargeHint'))}
          {textField(t('labs:dialogs.note'))}
        </>
      );
      submit = () =>
        labOutcome(order.id, {
          choice: 'remake',
          reason,
          borneBy,
          charge: borneBy === 'clinic' ? money : null,
          note,
        });
      break;
    case 'hold':
      body = textField(t('labs:dialogs.holdReason'), true);
      submit =
        text.trim().length >= 3 ? () => holdLabOrder(order.id, { reason: text.trim() }) : null;
      break;
    case 'cancel':
      body = (
        <>
          {textField(t('labs:dialogs.cancelReason'), true)}
          {charged &&
            canMoney &&
            chargeField(t('labs:dialogs.cancelCharge'), t('labs:dialogs.cancelChargeHint'))}
        </>
      );
      submit =
        text.trim().length >= 3
          ? () => cancelLabOrder(order.id, { reason: text.trim(), charge: charged ? money : null })
          : null;
      break;
    case 'link':
      body = (
        <Field label={t('labs:dialogs.chooseAppointment')}>
          {(props) => (
            <Select
              {...props}
              value={appointmentId}
              onChange={(event) => {
                setAppointmentId(event.target.value);
              }}
            >
              <option value="">{t('labs:order.noAppointment')}</option>
              {(proposal.data?.upcoming ?? []).map((ref) => (
                <option key={ref.id} value={ref.id}>
                  {`${formatDateTime(ref.startsAt, { timeZone: tenant.timeZone, locale })} · ${ref.dentistName}`}
                </option>
              ))}
            </Select>
          )}
        </Field>
      );
      submit = () => linkLabOrder(order.id, appointmentId === '' ? null : appointmentId);
      break;
  }
  const blocked = submit === null || (action !== 'expected' && action !== 'link' && day > today);
  const number = orderNumber(order).slice(2);
  const title = {
    send: t('labs:dialogs.sentTitle', { number }),
    receive: t('labs:dialogs.receivedTitle'),
    expected: t('labs:dialogs.expectedTitle'),
    back: t('labs:dialogs.backTitle'),
    remake: t('labs:dialogs.remakeTitle'),
    hold: t('labs:dialogs.holdTitle'),
    cancel: t('labs:dialogs.cancelTitle', { number }),
    link: t('labs:dialogs.linkTitle'),
  }[action];

  return (
    <div
      role="group"
      aria-label={title}
      className="flex flex-col gap-3 rounded-lg border border-border bg-faint p-3"
    >
      <h4 className="m-0 text-[13px] font-semibold">{title}</h4>
      {body}
      <div className="flex justify-end gap-2">
        <Button size="sm" disabled={busy} onClick={onCancel}>
          {t('common:cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          busy={busy}
          disabled={blocked}
          onClick={() => {
            if (submit) onRun(submit);
          }}
        >
          {t('labs:dialogs.confirm')}
        </Button>
      </div>
    </div>
  );
}
