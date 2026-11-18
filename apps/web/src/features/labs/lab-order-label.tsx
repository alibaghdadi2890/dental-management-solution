import type { LabOrderLabel, LabOrderSummary } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { LAB_LABEL_STYLES, summarise, useLabelText, useOpenLabOrders } from './lab-words';

/**
 * The one lab status label (C1), the same words and colours wherever it appears: *Not sent* ·
 * *Sent · due {date}* · *Due in n days* · *Overdue · n days* · *Arrived* · *On hold* · *Remake*. With several
 * open orders, the most urgent and "+n".
 */
export function LabOrderLabelPill({
  label,
  count = 1,
  className,
}: {
  label: LabOrderLabel;
  count?: number;
  className?: string;
}) {
  const { t } = useTranslation('labs');
  const text = useLabelText();
  return (
    <span
      className={cn(
        'inline-flex h-[22px] flex-none items-center gap-1 rounded-[5px] border px-2 text-[11.5px] leading-none whitespace-nowrap',
        LAB_LABEL_STYLES[label.kind],
        className,
      )}
    >
      {text(label)}
      {count > 1 && <span className="opacity-75">{t('label.more', { count: count - 1 })}</span>}
    </span>
  );
}

/** A patient's or an appointment's label, or nothing. */
export function LabSummaryPill({ orders }: { orders: readonly LabOrderSummary[] | undefined }) {
  const summary = orders ? summarise(orders) : null;
  return summary ? <LabOrderLabelPill label={summary.label} count={summary.count} /> : null;
}

/**
 * An appointment's lab work, on its calendar card and its row on Today (C1): a small pill, amber
 * *Lab pending* while any of it is still to come (an alert: the patient is booked for it), green
 * *Lab arrived* once all of it is in. Its tooltip says where the most urgent order stands. A
 * narrow card (`compact`) says only *Lab*, in the same colour.
 */
export function AppointmentLabMark({
  appointmentId,
  compact = false,
}: {
  appointmentId: string;
  compact?: boolean;
}) {
  const { t } = useTranslation('labs');
  const text = useLabelText();
  const { byAppointment } = useOpenLabOrders();
  const orders = byAppointment.get(appointmentId);
  const summary = orders ? summarise(orders) : null;
  if (!summary) return null;
  const arrived = summary.label.kind === 'arrived';
  return (
    <span
      title={t('label.markTitle', { label: text(summary.label) })}
      className={cn(
        'inline-flex h-[17px] flex-none items-center rounded-full border px-1.5 text-[10.5px] leading-none font-semibold whitespace-nowrap',
        arrived
          ? 'border-success-border bg-success-bg text-success'
          : 'border-warning-dot bg-warning-bg text-warning-ink',
      )}
    >
      {t(
        compact
          ? 'appointmentLab.short'
          : arrived
            ? 'appointmentLab.arrived'
            : 'appointmentLab.pending',
      )}
    </span>
  );
}
