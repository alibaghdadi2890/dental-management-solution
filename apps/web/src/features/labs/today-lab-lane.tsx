import type { LabOrderSummary, LabTodayReason, LabUndoStep, Session } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Popover } from 'radix-ui';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { apiErrorMessage } from '@/lib/api-error-message';
import {
  dateInputOrder,
  formatCalendarDate,
  formatDayMonth,
  formatTime,
  todayIn,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import { LabOrderLabelPill } from './lab-order-label';
import { LAB_ROW_ACCENTS, orderNumber, useItemText } from './lab-words';
import {
  expectLabOrder,
  invalidateLabs,
  labTodayQuery,
  receiveLabOrders,
  sendLabOrder,
  undoLabOrder,
} from './labs-api';

type Tenant = NonNullable<Session['tenant']>;
type Row = { reason: LabTodayReason; order: LabOrderSummary };

/** Expected dates lie ahead: the picker's ceiling. */
const FAR = '2100-12-31';
/** Hover long enough to mean it before the details open; leave briefly before they close. */
const OPEN_DELAY = 250;
const CLOSE_DELAY = 150;

/**
 * Today's **Lab work** lane (C3), for the current branch: late work, work not arrived for an
 * appointment today or on the next open day, work not sent yet, work at the lab and expected
 * within three days, and work arrived with no appointment — each once, most urgent first.
 *
 * A row is brief: a coloured edge and the label say which kind it is (not sent, sent, due soon,
 * overdue, arrived), then the patient, the lab, the first item and the appointment, and the one
 * action it needs (*Mark sent*, *Mark received*, *Book appointment*). Hovering or clicking the
 * row shows the rest — order number, dentist, every item, the dates — with the other actions.
 * A handled row leaves at once and offers *Undo*. Without `lab:manage` the rows have no actions.
 */
export function TodayLabLane({ branchId, tenant }: { branchId: string; tenant: Tenant }) {
  const { t, i18n } = useTranslation('labs');
  const canManage = usePermission('lab:manage');
  const lane = useQuery(labTodayQuery(branchId));
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string>();
  const rows = lane.data?.rows ?? [];

  const act = async (order: LabOrderSummary, work: () => Promise<unknown>, undo?: LabUndoStep) => {
    setBusy(order.id);
    try {
      await work();
      await invalidateLabs(queryClient);
      toast(t('today.handled', { number: orderNumber(order).slice(2) }), {
        tone: 'success',
        ...(undo
          ? {
              actionLabel: t('today.undo'),
              onAction: () => {
                void undoLabOrder(order.id, undo).then(() => invalidateLabs(queryClient));
              },
            }
          : {}),
      });
    } catch (failure) {
      toast(apiErrorMessage(failure, i18n), { tone: 'danger' });
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section aria-label={t('today.title')} className="mb-6">
      <h2 className="mb-2.5 text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal">
        {lane.data ? `${t('today.title')} · ${String(rows.length)}` : t('today.title')}
      </h2>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {rows.length === 0 ? (
          <p className="m-0 px-[18px] py-5 text-[12.5px] leading-snug text-ink-muted">
            {lane.isPending ? t('loading') : t('today.empty')}
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {rows.map((row) => (
              <LaneRow
                key={row.order.id}
                row={row}
                tenant={tenant}
                canManage={canManage}
                busy={busy === row.order.id}
                onAct={(work, undo) => void act(row.order, work, undo)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function LaneRow({
  row: { reason, order },
  tenant,
  canManage,
  busy,
  onAct,
}: {
  row: Row;
  tenant: Tenant;
  canManage: boolean;
  busy: boolean;
  onAct: (work: () => Promise<unknown>, undo?: LabUndoStep) => void;
}) {
  const { t, i18n } = useTranslation('labs');
  const locale = i18n.resolvedLanguage ?? 'en';
  const itemText = useItemText();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const today = todayIn(tenant.timeZone);
  const kind = order.label?.kind ?? 'to_send';
  const urgent = kind === 'late' || kind === 'due_soon';
  const unsent = order.status === 'to_send' || order.status === 'remake';
  const atLab = order.status === 'at_lab';

  // Hover opens after a short pause and closes once the pointer has left both the row and the card.
  const hover = (next: boolean) => () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => {
        setOpen(next);
      },
      next ? OPEN_DELAY : CLOSE_DELAY,
    );
  };
  const time = (iso: string) => formatTime(iso, { timeZone: tenant.timeZone, locale });
  const appointment = order.appointment
    ? order.appointment.localDate === today
      ? t('today.apptToday', { time: time(order.appointment.startsAt) })
      : t('today.apptOn', {
          date: formatDayMonth(order.appointment.localDate, locale),
          time: time(order.appointment.startsAt),
        })
    : null;
  const [first, ...more] = order.items.map(itemText);
  // Arrived with no appointment: that is the news; otherwise the appointment the work is for.
  const context = reason === 'book' ? t('today.reasons.book') : appointment;

  const markSent = () => {
    onAct(
      () =>
        sendLabOrder(order.id, {
          sentOn: today,
          // A digital case goes through the lab's software.
          via: order.submission === 'digital' ? 'lab_software' : 'courier',
        }),
      'sent',
    );
  };
  const markReceived = () => {
    onAct(() => receiveLabOrders({ orderIds: [order.id], receivedOn: today }), 'received');
  };

  const primary = !canManage ? null : unsent ? (
    <Button size="sm" variant="primary" busy={busy} onClick={markSent}>
      {t('order.actions.markSent')}
    </Button>
  ) : atLab && reason !== 'book' ? (
    <Button size="sm" variant={urgent ? 'primary' : 'outline'} busy={busy} onClick={markReceived}>
      {t('order.actions.markReceived')}
    </Button>
  ) : reason === 'book' ? (
    <Link
      to="/schedule"
      search={{ book: true, bookFor: order.patient.id }}
      className="text-[12.5px] font-medium text-primary hover:underline"
    >
      {t('order.actions.book')}
    </Link>
  ) : null;

  return (
    <li
      className={cn(
        'flex items-center gap-3 border-t border-s-[3px] border-row-divider py-2.5 ps-[15px] pe-[18px] first:border-t-0',
        LAB_ROW_ACCENTS[kind],
        kind === 'late' && 'bg-danger-bg/40',
      )}
    >
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={t('today.details', { name: order.patient.fullName })}
            onPointerEnter={hover(true)}
            onPointerLeave={hover(false)}
            className="min-w-0 flex-1 cursor-pointer rounded-md text-start outline-offset-2"
          >
            <span className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className={cn('text-ink', urgent ? 'font-semibold' : 'font-medium')}>
                {order.patient.fullName}
              </span>
              {order.label && <LabOrderLabelPill label={order.label} />}
              {order.priority === 'urgent' && (
                <span className="text-[11px] font-semibold tracking-[.04em] text-danger uppercase [&:lang(ar)]:tracking-normal">
                  {t('priority.urgent')}
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-ink-muted">
              {[
                order.labName,
                more.length > 0 ? t('today.itemsMore', { item: first, count: more.length }) : first,
                context,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            onPointerEnter={hover(true)}
            onPointerLeave={hover(false)}
            // Opened by hover, the card must not take the focus away from the page.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
            }}
            className="z-50 w-[340px] max-w-[calc(100vw-24px)] animate-fadein rounded-[10px] border border-border bg-surface p-3.5 text-[12.5px] shadow-[0_10px_28px_rgba(27,26,31,.14)]"
          >
            <Details
              reason={reason}
              order={order}
              tenant={tenant}
              canManage={canManage}
              busy={busy}
              appointment={appointment}
              onAct={onAct}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {primary && <div className="flex flex-none items-center">{primary}</div>}
    </li>
  );
}

/** The rest of a lane row, on hover or click: the order, every item, the dates, other actions. */
function Details({
  reason,
  order,
  tenant,
  canManage,
  busy,
  appointment,
  onAct,
}: {
  reason: LabTodayReason;
  order: LabOrderSummary;
  tenant: Tenant;
  canManage: boolean;
  busy: boolean;
  appointment: string | null;
  onAct: (work: () => Promise<unknown>, undo?: LabUndoStep) => void;
}) {
  const { t, i18n } = useTranslation('labs');
  const locale = i18n.resolvedLanguage ?? 'en';
  const itemText = useItemText();
  const today = todayIn(tenant.timeZone);
  const [expecting, setExpecting] = useState(false);
  const [expectedOn, setExpectedOn] = useState(order.expectedOn ?? today);
  const date = (value: string) => formatCalendarDate(value, locale);
  const row = (label: string, value: ReactNode) => (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="m-0 min-w-0">{value}</dd>
    </>
  );
  const changeExpected =
    canManage && order.status === 'at_lab' && (reason === 'late' || reason === 'expected');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span dir="ltr" className="font-mono text-[12px] text-ink-muted">
          {orderNumber(order)}
        </span>
        {order.label && <LabOrderLabelPill label={order.label} />}
      </div>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[13px] font-medium">
        {order.items.map((item) => (
          <li key={item.id}>{itemText(item)}</li>
        ))}
      </ul>
      <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        {row(
          t('form.lab'),
          <>
            {order.labName}
            {order.labPhone && (
              <>
                {' · '}
                <a
                  dir="ltr"
                  href={`tel:${order.labPhone}`}
                  className="text-primary hover:underline"
                >
                  {order.labPhone}
                </a>
              </>
            )}
          </>,
        )}
        {row(t('order.dentist'), order.dentistName)}
        {order.status === 'to_send' || order.status === 'remake'
          ? row(t('today.waiting'), date(order.waitingSince))
          : order.sentOn && row(t('today.sent'), date(order.sentOn))}
        {order.expectedOn &&
          order.status !== 'arrived' &&
          row(
            t('today.expected'),
            <>
              {date(order.expectedOn)}
              {order.promisedOn && order.promisedOn !== order.expectedOn && (
                <span className="text-ink-muted">
                  {' · '}
                  {t('today.promised', { date: formatDayMonth(order.promisedOn, locale) })}
                </span>
              )}
            </>,
          )}
        {order.receivedOn && row(t('today.arrived'), date(order.receivedOn))}
        {row(t('order.appointment'), appointment ?? t('order.noAppointment'))}
      </dl>
      {expecting ? (
        <div className="flex items-end gap-2">
          <DateInput
            value={expectedOn}
            onChange={setExpectedOn}
            order={dateInputOrder(tenant.country)}
            today={today}
            max={FAR}
            pickerLabel={t('dialogs.chooseDate')}
            aria-label={t('dialogs.expectedOn')}
          />
          <Button
            size="sm"
            variant="primary"
            busy={busy}
            disabled={!/^\d{4}-\d{2}-\d{2}$/.test(expectedOn)}
            onClick={() => {
              onAct(() => expectLabOrder(order.id, expectedOn));
            }}
          >
            {t('dialogs.confirm')}
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-row-divider pt-2.5">
        <Link
          to="/lab"
          search={{ order: order.id }}
          className="text-[12.5px] font-medium text-primary hover:underline"
        >
          {t('record.open')}
        </Link>
        {changeExpected && !expecting && (
          <button
            type="button"
            onClick={() => {
              setExpecting(true);
            }}
            className="cursor-pointer text-[12.5px] font-medium text-primary hover:underline"
          >
            {t('order.actions.newExpected')}
          </button>
        )}
        {reason === 'due' && order.appointment && (
          <Link
            to="/schedule"
            search={{ date: order.appointment.localDate, appointment: order.appointment.id }}
            className="text-[12.5px] font-medium text-primary hover:underline"
          >
            {t('order.actions.reschedule')}
          </Link>
        )}
      </div>
    </div>
  );
}
