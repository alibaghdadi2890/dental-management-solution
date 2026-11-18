import {
  formatLabOrderNumber,
  type LabOrder,
  type LabOrderItem,
  type LabOrderLabel,
  type LabOrderSummary,
  mostUrgentLabel,
  type Session,
} from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/features/auth/use-permission';
import { useToothLabel } from '@/features/clinical/chart/use-chart-settings';
import { formatCalendarDate, formatDayMonth } from '@/lib/format';
import { openLabOrdersQuery } from './labs-api';

type Tenant = NonNullable<Session['tenant']>;

/** `L-000123`. */
export const orderNumber = (order: Pick<LabOrderSummary, 'displayNumber'>) =>
  formatLabOrderNumber(order.displayNumber);

/**
 * The four kinds of lab work told apart at a glance (with arrived, on hold and remake): the
 * label's colours and weight, and on Today's lane each row's leading edge.
 *
 * - **Not sent** — neutral, a dashed outline: nothing has happened yet.
 * - **Sent** — the app's indigo, light: at the lab, nothing to do.
 * - **Due soon** — amber, bold: expected within three days.
 * - **Overdue** — solid red, bold: past its expected date.
 */
export const LAB_LABEL_STYLES: Record<LabOrderLabel['kind'], string> = {
  to_send: 'border-dashed border-border-strong bg-surface text-ink-secondary font-medium',
  at_lab: 'border-primary-tint-border bg-primary-tint text-primary font-medium',
  due_soon: 'border-warning-border bg-warning-bg text-warning-ink font-semibold',
  late: 'border-danger bg-danger text-white font-semibold',
  arrived: 'border-success-border bg-success-bg text-success font-medium',
  on_hold: 'border-border bg-subtle text-ink-secondary font-normal',
  remake: 'border-dashed border-danger-border bg-surface text-danger font-medium',
};

/** Today's lane: each row's leading edge, in the colour of its kind. */
export const LAB_ROW_ACCENTS: Record<LabOrderLabel['kind'], string> = {
  to_send: 'border-s-border-strong',
  at_lab: 'border-s-primary',
  due_soon: 'border-s-warning-dot',
  late: 'border-s-danger',
  arrived: 'border-s-success',
  on_hold: 'border-s-border',
  remake: 'border-s-danger-border',
};

/** The one wording of a label (C1): "Sent · due 18 Nov", "Overdue · 2 days". */
export function useLabelText(): (label: LabOrderLabel) => string {
  const { t, i18n } = useTranslation('labs');
  const locale = i18n.resolvedLanguage ?? 'en';
  return useCallback(
    (label: LabOrderLabel) => {
      switch (label.kind) {
        case 'at_lab':
          return t('label.at_lab', { date: label.due ? formatDayMonth(label.due, locale) : '' });
        case 'due_soon':
          return label.daysLeft === 0
            ? t('label.dueToday')
            : label.daysLeft === 1
              ? t('label.dueTomorrow')
              : t('label.dueIn', { count: label.daysLeft ?? 2 });
        case 'late':
          return t('label.late', { count: label.daysLate ?? 1 });
        default:
          return t(`label.${label.kind}`);
      }
    },
    [t, locale],
  );
}

/** "Zirconia crown #26 · A2", "Night guard · Upper arch", in the clinic's tooth notation. */
export function useItemText(): (item: Omit<LabOrderItem, 'id'>) => string {
  const { t } = useTranslation('labs');
  const toothLabel = useToothLabel();
  return useCallback(
    (item) => {
      const what = `${item.quantity > 1 ? `${t('order.quantity', { count: item.quantity })} ` : ''}${item.description}`;
      // Teeth read as part of the item ("Crown #16"); an arch is its own part ("Night guard · Upper arch").
      const parts =
        item.target === 'teeth'
          ? [`${what} ${item.teeth.map((code) => toothLabel(code)).join(' ')}`]
          : [what, t(`target.${item.target}`)];
      if (item.shade) parts.push(t('order.shade', { shade: item.shade }));
      return parts.join(' · ');
    },
    [t, toothLabel],
  );
}

/** The most urgent label among `orders`, and how many open orders there are (C1). */
export function summarise(
  orders: readonly LabOrderSummary[],
): { label: LabOrderLabel; count: number } | null {
  const label = mostUrgentLabel(orders.map((order) => order.label));
  return label ? { label, count: orders.filter((order) => order.label !== null).length } : null;
}

/** Open orders grouped by patient and by appointment, for the list rows and the calendar. */
export function groupOpenOrders(orders: readonly LabOrderSummary[]) {
  const byPatient = new Map<string, LabOrderSummary[]>();
  const byAppointment = new Map<string, LabOrderSummary[]>();
  for (const order of orders) {
    byPatient.set(order.patient.id, [...(byPatient.get(order.patient.id) ?? []), order]);
    if (order.appointment) {
      byAppointment.set(order.appointment.id, [
        ...(byAppointment.get(order.appointment.id) ?? []),
        order,
      ]);
    }
  }
  return { byPatient, byAppointment };
}

/** The open orders behind every label, grouped, for whoever may see lab work. */
export function useOpenLabOrders() {
  const canRead = usePermission('lab:read');
  const query = useQuery(openLabOrdersQuery(canRead));
  return useMemo(() => {
    const orders = query.data ?? [];
    return { orders, ...groupOpenOrders(orders), enabled: canRead };
  }, [query.data, canRead]);
}

/** The day the work is needed by: the linked appointment, else the expected date. */
export const neededBy = (order: LabOrder) => order.appointment?.localDate ?? order.expectedOn;

/**
 * The lab slip (B7) as text, for an email the user writes in their own mail application: clinic,
 * dentist, patient, number, items with teeth or arch and shade, priority, notes, date and
 * needed-by date. Never a price.
 */
export function slipText(
  order: LabOrder,
  tenant: Tenant,
  t: TFunction<['labs', 'common']>,
  itemText: (item: Omit<LabOrderItem, 'id'>) => string,
  locale: string,
): string {
  const date = (value: string | null) => (value ? formatCalendarDate(value, locale) : '—');
  const needed = neededBy(order);
  return [
    `${t('labs:slip.title')} ${orderNumber(order)}`,
    `${t('labs:slip.clinic')}: ${tenant.name}`,
    `${t('labs:slip.lab')}: ${order.labName}`,
    `${t('labs:slip.dentist')}: ${order.dentistName}`,
    `${t('labs:slip.patient')}: ${order.patient.fullName}`,
    `${t('labs:slip.date')}: ${date(order.createdAt.slice(0, 10))}`,
    ...(needed ? [`${t('labs:slip.neededBy')}: ${date(needed)}`] : []),
    `${t('labs:slip.priority')}: ${t(`labs:priority.${order.priority}`)}`,
    '',
    `${t('labs:slip.items')}:`,
    ...order.items.map((item) => `- ${itemText(item)}`),
    ...(order.notes ? ['', `${t('labs:slip.notes')}: ${order.notes}`] : []),
  ].join('\n');
}
