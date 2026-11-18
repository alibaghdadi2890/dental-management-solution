import type { LabOrderSummary, Patient } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/list';
import { RightPanel } from '@/components/ui/right-panel';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { formatCalendarDate, formatDateTime } from '@/lib/format';
import { LabOrderLabelPill } from './lab-order-label';
import { LabOrderPanel } from './lab-order-panel';
import { orderNumber, useItemText, useOpenLabOrders } from './lab-words';
import { labOrdersQuery } from './labs-api';
import { NewLabOrderPanel } from './new-lab-order-panel';

/**
 * The patient record's **Lab work** card (C1, agreed layout): every open order with its number,
 * lab, items and teeth, label and dates and linked appointment; a row opens the order's panel.
 * *All orders* lists the patient's history, done and cancelled included; *New lab order* starts
 * one for this patient. Lab orders belong to the record, whoever the dentist (O9).
 */
export function PatientLabCard({ patient }: { patient: Patient }) {
  const { t } = useTranslation('labs');
  const { data: session } = useSession();
  const canManage = usePermission('lab:manage');
  const { byPatient } = useOpenLabOrders();
  const [opened, setOpened] = useState<string>();
  const [all, setAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const open = byPatient.get(patient.id) ?? [];
  if (!session?.tenant) return null;

  return (
    <>
      <Card
        title={t('record.title')}
        action={
          <span className="flex gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAll(true);
              }}
            >
              {t('record.all')}
            </Button>
            {canManage && patient.archivedAt === null && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setCreating(true);
                }}
              >
                {t('record.new')}
              </Button>
            )}
          </span>
        }
      >
        {open.length === 0 ? (
          <p className="m-0 text-[12.5px] text-ink-muted">{t('record.none')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {open.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                timeZone={session.tenant?.timeZone ?? 'UTC'}
                onOpen={() => {
                  setOpened(order.id);
                }}
              />
            ))}
          </ul>
        )}
      </Card>
      {opened && (
        <LabOrderPanel
          orderId={opened}
          session={session}
          onClose={() => {
            setOpened(undefined);
          }}
        />
      )}
      {all && (
        <AllOrders
          patient={patient}
          timeZone={session.tenant.timeZone}
          onOpen={(id) => {
            setAll(false);
            setOpened(id);
          }}
          onClose={() => {
            setAll(false);
          }}
        />
      )}
      {creating && (
        <NewLabOrderPanel
          session={session}
          defaults={{ patient: { id: patient.id, fullName: patient.fullName } }}
          onClose={() => {
            setCreating(false);
          }}
          onCreated={(id) => {
            setCreating(false);
            setOpened(id);
          }}
        />
      )}
    </>
  );
}

function OrderRow({
  order,
  timeZone,
  onOpen,
}: {
  order: LabOrderSummary;
  timeZone: string;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation('labs');
  const locale = i18n.resolvedLanguage ?? 'en';
  const itemText = useItemText();
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full cursor-pointer flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-start hover:border-ink"
      >
        <span className="flex flex-wrap items-center gap-2 text-[13px]">
          <span dir="ltr" className="font-mono text-[12px] text-ink-muted">
            {orderNumber(order)}
          </span>
          <span className="font-medium">{order.labName}</span>
          {order.label ? (
            <LabOrderLabelPill label={order.label} />
          ) : (
            <Pill tone="neutral">{t(`status.${order.status}`)}</Pill>
          )}
        </span>
        <span className="text-[12.5px] text-ink-secondary">
          {order.items.map(itemText).join(', ')}
        </span>
        <span className="text-[12px] text-ink-muted">
          {order.sentOn &&
            `${t('record.sent', { date: formatCalendarDate(order.sentOn, locale) })} · `}
          {order.appointment
            ? formatDateTime(order.appointment.startsAt, { timeZone, locale })
            : t('order.noAppointment')}
        </span>
      </button>
    </li>
  );
}

function AllOrders({
  patient,
  timeZone,
  onOpen,
  onClose,
}: {
  patient: Patient;
  timeZone: string;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('labs');
  const orders = useQuery(labOrdersQuery({ patientId: patient.id }));
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
        eyebrow={t('record.title')}
        title={t('record.allTitle', { name: patient.fullName })}
        onClose={onClose}
        className="fixed inset-y-0 end-0 z-40 max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
      >
        {(orders.data?.items ?? []).length === 0 ? (
          <p className="m-0 text-[13px] text-ink-muted">
            {orders.isPending ? t('loading') : t('record.none')}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {(orders.data?.items ?? []).map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                timeZone={timeZone}
                onOpen={() => {
                  onOpen(order.id);
                }}
              />
            ))}
          </ul>
        )}
      </RightPanel>
    </>
  );
}
