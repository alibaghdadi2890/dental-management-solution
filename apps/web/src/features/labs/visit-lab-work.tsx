import {
  type LabOrderSummary,
  type LabOutcomeChoice,
  LAB_OUTCOME_CHOICES,
  type ToothCode,
  type Visit,
} from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatCalendarDate } from '@/lib/format';
import { LabOrderLabelPill } from './lab-order-label';
import { orderNumber, useItemText, useOpenLabOrders } from './lab-words';
import { invalidateLabs, labOutcome, undoLabOrder } from './labs-api';
import { NewLabOrderPanel } from './new-lab-order-panel';

type Mode = 'workspace' | 'complete';

/**
 * A visit's lab work (B6). In the workspace: a visible *Lab work arrived* card with each arrived
 * order's details, and *New lab order* with the patient, dentist and visit filled in, the
 * selected tooth proposed and the teeth worked on in the visit offered one click away. At
 * Complete: one line per arrived order with *Fitted · Back to the lab · Remake required · Not
 * used today* — applied when chosen, with an Undo; left alone, the order
 * stays Arrived — and, for an order this visit created, when the lab work is expected, so the next
 * appointment is not recommended earlier.
 */
export function VisitLabWork({
  visit,
  mode,
  patientName = '',
  teeth = [],
}: {
  visit: Pick<Visit, 'id' | 'patientId' | 'dentistId' | 'status' | 'services'>;
  mode: Mode;
  /** For *New lab order* in the workspace: the patient may have no order to take it from yet. */
  patientName?: string;
  teeth?: readonly ToothCode[];
}) {
  const { t, i18n } = useTranslation('labs');
  const locale = i18n.resolvedLanguage ?? 'en';
  const { data: session } = useSession();
  const canRead = usePermission('lab:read');
  const canManage = usePermission('lab:manage');
  const { byPatient } = useOpenLabOrders();
  const itemText = useItemText();
  const [creating, setCreating] = useState(false);
  if (!canRead || !session?.tenant) return null;
  const orders = byPatient.get(visit.patientId) ?? [];
  const arrived = orders.filter((order) => order.status === 'arrived');
  const fromThisVisit = orders.filter(
    (order) => order.visitId === visit.id && order.status !== 'arrived',
  );
  const live = visit.status === 'in_progress' || visit.status === 'paused';
  if (mode === 'complete' && arrived.length === 0 && fromThisVisit.length === 0) return null;
  const panel = creating && (
    <NewLabOrderPanel
      session={session}
      defaults={{
        patient: { id: visit.patientId, fullName: patientName },
        dentistId: visit.dentistId,
        visitId: visit.id,
        teeth,
        suggestedTeeth: visit.services.flatMap((service) => service.toothCode ?? []),
      }}
      onClose={() => {
        setCreating(false);
      }}
      onCreated={() => {
        setCreating(false);
      }}
    />
  );
  if (mode === 'workspace' && arrived.length === 0) {
    return canManage && live ? (
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setCreating(true);
          }}
        >
          {t('record.new')}
        </Button>
        {panel}
      </div>
    ) : null;
  }

  return (
    <section
      aria-label={mode === 'complete' ? t('visit.completeTitle') : t('visit.arrivedTitle')}
      className="rounded-xl border border-border bg-surface px-4 py-3 text-[13px]"
    >
      <div className="mb-2 flex items-center gap-2">
        <h3 className="m-0 text-[13px] font-semibold">
          {mode === 'complete' ? t('visit.completeTitle') : t('visit.arrivedTitle')}
        </h3>
        {mode === 'workspace' && canManage && live && (
          <Button
            size="sm"
            variant="outline"
            className="ms-auto"
            onClick={() => {
              setCreating(true);
            }}
          >
            {t('record.new')}
          </Button>
        )}
      </div>
      {mode === 'complete' && arrived.length > 0 && (
        <p className="m-0 mb-2 text-[12.5px] text-ink-muted">{t('visit.completeHint')}</p>
      )}
      {arrived.length === 0 && mode === 'workspace' ? (
        <p className="m-0 text-[12.5px] text-ink-muted">{t('record.none')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {arrived.map((order) =>
            mode === 'complete' ? (
              <OutcomeLine key={order.id} order={order} canManage={canManage} />
            ) : (
              <li key={order.id} className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="font-mono text-[12px] text-ink-muted">
                    {orderNumber(order)}
                  </span>
                  <span className="font-medium">{order.labName}</span>
                  {order.label && <LabOrderLabelPill label={order.label} />}
                </span>
                <span className="text-ink-secondary">{order.items.map(itemText).join(', ')}</span>
                {order.receivedOn && (
                  <span className="text-[12px] text-ink-muted">
                    {t('visit.arrivedOn', { date: formatCalendarDate(order.receivedOn, locale) })}
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {mode === 'complete' &&
        fromThisVisit.map((order) => (
          <p key={order.id} className="m-0 mt-2 text-[12.5px] text-ink-secondary">
            {orderNumber(order)} ·{' '}
            {order.expectedOn
              ? t('visit.expectedHint', { date: formatCalendarDate(order.expectedOn, locale) })
              : t('order.waitDays', { count: order.expectedDays })}
          </p>
        ))}
      {panel}
    </section>
  );
}

type Choice = LabOutcomeChoice | 'not_used';

function OutcomeLine({ order, canManage }: { order: LabOrderSummary; canManage: boolean }) {
  const { t, i18n } = useTranslation('labs');
  const queryClient = useQueryClient();
  const toast = useToast();
  const itemText = useItemText();
  const [choice, setChoice] = useState<Choice | ''>('');
  const [busy, setBusy] = useState(false);

  const apply = async (next: Choice | '') => {
    setChoice(next);
    if (next === '' || next === 'not_used') return;
    setBusy(true);
    try {
      await labOutcome(order.id, {
        choice: next,
        ...(next === 'remake' ? { reason: 'other' as const, borneBy: 'lab' as const } : {}),
      });
      await invalidateLabs(queryClient);
      toast(t('visit.applied', { count: 1 }), {
        tone: 'success',
        actionLabel: t('today.undo'),
        onAction: () => {
          void undoLabOrder(order.id, next === 'fitted' ? 'done' : 'outcome').then(() =>
            invalidateLabs(queryClient),
          );
        },
      });
    } catch (failure) {
      setChoice('');
      toast(apiErrorMessage(failure, i18n), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-2">
      <span dir="ltr" className="font-mono text-[12px] text-ink-muted">
        {orderNumber(order)}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {order.labName} · {order.items.map(itemText).join(', ')}
      </span>
      {canManage && (
        <Select
          aria-label={t('visit.choose')}
          value={choice}
          disabled={busy}
          className="h-8 w-56"
          onChange={(event) => void apply(event.target.value as Choice | '')}
        >
          <option value="">{t('visit.choose')}</option>
          {LAB_OUTCOME_CHOICES.map((value) => (
            <option key={value} value={value}>
              {t(`outcome.${value}`)}
            </option>
          ))}
          <option value="not_used">{t('outcome.notUsed')}</option>
        </Select>
      )}
    </li>
  );
}

/**
 * The start-visit notice (B6): the patient's arrived work, and a warning for work linked to this
 * appointment that has not arrived.
 */
export function StartVisitLabNotice({
  patientId,
  appointmentId,
}: {
  patientId: string;
  appointmentId: string | undefined;
}) {
  const { t, i18n } = useTranslation('labs');
  const locale = i18n.resolvedLanguage ?? 'en';
  const { byPatient } = useOpenLabOrders();
  const itemText = useItemText();
  const orders = byPatient.get(patientId) ?? [];
  const arrived = orders.filter((order) => order.status === 'arrived');
  const missing = appointmentId
    ? orders.filter(
        (order) => order.appointment?.id === appointmentId && order.status !== 'arrived',
      )
    : [];
  if (arrived.length === 0 && missing.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {arrived.length > 0 && (
        <div className="rounded-md border border-success-border bg-success-bg px-2.5 py-2 text-[12.5px]">
          <p className="m-0 font-semibold text-success">{t('visit.arrivedTitle')}</p>
          {arrived.map((order) => (
            <p key={order.id} className="m-0 text-ink">
              {orderNumber(order)} · {order.labName} · {order.items.map(itemText).join(', ')}
              {order.receivedOn &&
                ` · ${t('visit.arrivedOn', { date: formatCalendarDate(order.receivedOn, locale) })}`}
            </p>
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <p
          role="alert"
          className="m-0 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-[12.5px] text-warning"
        >
          {t('visit.notArrived')}:{' '}
          {missing.map((order) => `${orderNumber(order)} · ${order.labName}`).join(', ')}
        </p>
      )}
    </div>
  );
}
