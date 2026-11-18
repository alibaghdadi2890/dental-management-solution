import type { LabOrderSummary, Session } from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatCalendarDate, todayIn } from '@/lib/format';
import { LabOrderLabelPill } from './lab-order-label';
import { orderNumber, useItemText, useOpenLabOrders } from './lab-words';
import { invalidateLabs, receiveLabOrders } from './labs-api';

type Tenant = NonNullable<Session['tenant']>;

/**
 * An appointment's lab work in the calendar popover (C1): each linked order's full label, its
 * summary, and *Mark received* for work at the lab. Nothing when no order is linked.
 */
export function AppointmentLabWork({
  appointmentId,
  tenant,
}: {
  appointmentId: string;
  tenant: Tenant;
}) {
  const { t, i18n } = useTranslation('labs');
  const { byAppointment } = useOpenLabOrders();
  const canManage = usePermission('lab:manage');
  const queryClient = useQueryClient();
  const toast = useToast();
  const itemText = useItemText();
  const [busy, setBusy] = useState<string>();
  const orders = byAppointment.get(appointmentId) ?? [];
  if (orders.length === 0) return null;

  const receive = async (order: LabOrderSummary) => {
    setBusy(order.id);
    try {
      await receiveLabOrders({ orderIds: [order.id], receivedOn: todayIn(tenant.timeZone) });
      await invalidateLabs(queryClient);
    } catch (failure) {
      toast(apiErrorMessage(failure, i18n), { tone: 'danger' });
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 border-t border-inner-divider p-0 pt-2">
      {orders.map((order) => (
        <li key={order.id} className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          {order.label && <LabOrderLabelPill label={order.label} />}
          <Link
            to="/lab"
            search={{ order: order.id }}
            className="font-mono text-[12px] text-primary hover:underline"
            dir="ltr"
          >
            {orderNumber(order)}
          </Link>
          <span className="min-w-0 truncate text-ink-secondary">
            {order.labName} · {order.items.map(itemText).join(', ')}
          </span>
          {canManage && order.status === 'at_lab' && (
            <Button size="sm" busy={busy === order.id} onClick={() => void receive(order)}>
              {t('order.actions.markReceived')}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The booking warning (B5): the patient's open orders expected after the chosen day. Advisory —
 * no override, nothing blocks.
 */
export function LabBookingWarning({
  patientId,
  day,
}: {
  patientId: string | null | undefined;
  day: string | null | undefined;
}) {
  const { t, i18n } = useTranslation('labs');
  const locale = i18n.resolvedLanguage ?? 'en';
  const { byPatient } = useOpenLabOrders();
  if (!patientId || !day) return null;
  const late = (byPatient.get(patientId) ?? []).filter(
    (order) => order.status !== 'arrived' && order.expectedOn !== null && order.expectedOn > day,
  );
  if (late.length === 0) return null;
  return (
    <div
      role="status"
      className="rounded-md border border-warning-border bg-warning-bg px-2.5 py-1.5 text-[12.5px] text-warning"
    >
      {late.map((order) => (
        <p key={order.id} className="m-0">
          {t('booking.warning', {
            number: orderNumber(order).slice(2),
            date: formatCalendarDate(order.expectedOn ?? day, locale),
          })}
        </p>
      ))}
    </div>
  );
}
