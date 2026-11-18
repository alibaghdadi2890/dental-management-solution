import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/session';
import { ItemsTable, Parties, PrintSheet } from '@/features/billing/printables/print-sheet';
import { formatCalendarDate } from '@/lib/format';
import { neededBy, orderNumber, useItemText } from './lab-words';
import { labOrderQuery } from './labs-api';

/** `/print/lab-slip/:orderId`: the printable slip, through the existing printables (B7). */
export function LabSlipDocument({ orderId }: { orderId: string }) {
  const { t, i18n } = useTranslation(['labs', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const { data: session } = useSession();
  const order = useQuery(labOrderQuery(orderId));
  const itemText = useItemText();
  const data = order.data;
  const date = (value: string | null) => (value ? formatCalendarDate(value, locale) : '—');
  return (
    <PrintSheet
      title={t('labs:slip.title')}
      number={data ? orderNumber(data) : ''}
      state={order.isError ? 'error' : data ? undefined : 'loading'}
    >
      {data && (
        <>
          <Parties
            columns={[
              { label: t('labs:slip.clinic'), lines: [session?.tenant?.name, data.dentistName] },
              { label: t('labs:slip.lab'), lines: [data.labName, data.labPhone] },
              {
                label: t('labs:slip.patient'),
                lines: [data.patient.fullName, data.patient.displayNumber],
              },
            ]}
          />
          <Parties
            columns={[
              { label: t('labs:slip.date'), lines: [date(data.createdAt.slice(0, 10))] },
              { label: t('labs:slip.neededBy'), lines: [date(neededBy(data))] },
              { label: t('labs:slip.priority'), lines: [t(`labs:priority.${data.priority}`)] },
            ]}
          />
          <ItemsTable
            headers={[t('labs:slip.items')]}
            rows={data.items.map((item) => [itemText(item)])}
            numeric={[]}
          />
          {data.notes && (
            <p className="mt-6 text-[12px] whitespace-pre-wrap">
              <strong>{t('labs:slip.notes')}: </strong>
              {data.notes}
            </p>
          )}
        </>
      )}
    </PrintSheet>
  );
}
