import { formatQuoteNumber, fromCents, toCents } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/session';
import { useToothLabel } from '@/features/clinical/chart/use-chart-settings';
import { chartQuery } from '@/features/clinical/visits-api';
import { patientQuery } from '@/features/patients/patients-api';
import { formatCalendarDate, formatMoney, todayIn } from '@/lib/format';
import { ItemsTable, Parties, PrintSheet, Totals } from './print-sheet';

const VALID_DAYS = 60;

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days))
    .toISOString()
    .slice(0, 10);
}

/**
 * A treatment-plan quote (B9, Q3): the patient's open plans at the prices they were planned at,
 * valid 60 days, with two signature lines. Printed on demand, not stored: its number is
 * `EST-<patient number>-<date>`.
 */
export function QuoteDocument({ patientId }: { patientId: string }) {
  const { t, i18n } = useTranslation('printables');
  const locale = i18n.resolvedLanguage ?? 'en';
  const { data: session } = useSession();
  const toothLabel = useToothLabel();
  const patient = useQuery(patientQuery(patientId));
  const chart = useQuery(chartQuery(patientId));
  const today = session?.tenant ? todayIn(session.tenant.timeZone) : '';
  const plans = (chart.data?.plans ?? []).filter((plan) => plan.status === 'planned');
  const currency = plans[0]?.price.currency ?? session?.tenant?.currency ?? 'USD';
  const total = plans.reduce((sum, plan) => sum + toCents(plan.price.amount), 0n);
  const dentists = [...new Set(plans.map((plan) => plan.dentistName))];

  return (
    <PrintSheet
      title={t('quote.title')}
      number={patient.data && today ? formatQuoteNumber(patient.data.displayNumber, today) : ''}
      state={
        patient.isError || chart.isError
          ? 'error'
          : patient.data && chart.data
            ? undefined
            : 'loading'
      }
    >
      {patient.data && chart.data && (
        <>
          <Parties
            columns={[
              { label: t('patient'), lines: [patient.data.fullName, patient.data.displayNumber] },
              { label: t('quote.preparedBy'), lines: dentists.length > 0 ? dentists : ['—'] },
              { label: t('insurance'), lines: [patient.data.insurance ?? '—'] },
            ]}
          />
          {plans.length === 0 ? (
            <p className="text-ink-muted">{t('quote.empty')}</p>
          ) : (
            <ItemsTable
              headers={[t('code'), t('quote.treatment'), t('tooth'), t('amount')]}
              numeric={[3]}
              rows={plans.map((plan) => [
                <span key="code" className="font-mono">
                  {plan.code}
                </span>,
                plan.name,
                plan.toothCode ? toothLabel(plan.toothCode) : '—',
                formatMoney(plan.price, locale),
              ])}
            />
          )}
          <Totals
            lines={[
              {
                label: t('quote.estimate'),
                amount: formatMoney({ amount: fromCents(total), currency }, locale),
                strong: true,
              },
            ]}
          />
          <p className="mt-6 mb-0 text-[11.5px] text-ink-secondary">
            {t('quote.validity', {
              days: VALID_DAYS,
              date: today ? formatCalendarDate(addDays(today, VALID_DAYS), locale) : '',
            })}
          </p>
          <div className="mt-auto grid grid-cols-2 gap-16 pt-16">
            {[t('quote.signPatient'), t('quote.signDentist')].map((label) => (
              <div key={label} className="border-t border-ink pt-2 text-[11px] text-ink-secondary">
                {label}
              </div>
            ))}
          </div>
        </>
      )}
    </PrintSheet>
  );
}
