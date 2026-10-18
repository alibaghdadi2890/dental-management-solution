import { missingInformation, type Patient, type Session } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/features/auth/use-permission';
import { balanceQuery } from '@/features/billing/billing-api';
import { owedBalances } from '@/features/billing/owed-balances';
import { useRecordPayment } from '@/features/billing/payments/payment-dialog-context';
import { useSessionLabel } from '@/features/clinical/flow/flow-labels';
import { PriorityChip, SessionChip } from '@/features/clinical/flow/priority-chip';
import { useTargetLabel } from '@/features/clinical/flow/use-target-label';
import type { StartPreset } from '@/features/clinical/start-visit-popover';
import { chartQuery, lastVisitQuery } from '@/features/clinical/visits-api';
import { formatCalendarDate, formatDate, formatList, formatMoney } from '@/lib/format';
import { contactsQuery } from '../contacts-api';
import { cn } from '@/lib/utils';
import { type AttentionItem, needsAttention } from './needs-attention';

type Tenant = NonNullable<Session['tenant']>;

interface Row {
  key: string;
  /** The tooth or level, or a sign for a row that is not about one. */
  chip: string;
  muted: boolean;
  title: string;
  reason: string;
  tag: ReactNode;
  action: { label: string; run: () => void } | null;
}

/**
 * The Overview's **Needs attention** card (feature 10, V11): what to do next for this patient,
 * most pressing first (`needsAttention`) — work in progress → **Continue**, an urgent plan the
 * patient accepted → **Treat**, money owed → **Record payment**, never examined → **Start
 * examination**, important details missing → **Complete details** (ADR-0052) — or "Nothing
 * needs attention". A row whose action the caller may not take shows without its button. The
 * plan rows need `visit:read`, the balance `payment:read`. A patient without a phone is reached
 * through a guardian or billing contact, so their contacts are read only then.
 */
export function NeedsAttentionCard({
  patient,
  tenant,
  onStart,
  onCompleteDetails,
}: {
  patient: Patient;
  tenant: Tenant;
  /** Starts (or resumes) a visit; left out when the caller may not, or the record is closed. */
  onStart: ((preset: StartPreset) => void) | undefined;
  /** Opens the Patient information tab; left out when the caller may not edit the record. */
  onCompleteDetails: (() => void) | undefined;
}) {
  const { t, i18n } = useTranslation(['patients', 'clinical']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const titleId = useId();
  const target = useTargetLabel();
  const sessionLabel = useSessionLabel();
  const openPayment = useRecordPayment();
  const canVisits = usePermission('visit:read');
  const canPay = usePermission('payment:read');
  const chart = useQuery({ ...chartQuery(patient.id), enabled: canVisits });
  const lastVisit = useQuery({ ...lastVisitQuery(patient.id), enabled: canVisits });
  const balance = useQuery({ ...balanceQuery(patient.id), enabled: canPay });
  const contacts = useQuery({ ...contactsQuery(patient.id), enabled: patient.phone === null });
  const reachable = contacts.data?.some((link) => link.isGuardian || link.isBillingContact);
  const [lead] = owedBalances(balance.data?.balances ?? [], tenant.currency);

  const items = needsAttention({
    chart: chart.data,
    owed: lead && Number(lead.amount) > 0 ? lead : null,
    hasVisits: lastVisit.data === undefined ? undefined : lastVisit.data !== null,
    missing:
      patient.phone === null && reachable === undefined
        ? undefined
        : missingInformation({
            dateOfBirth: patient.dateOfBirth,
            sex: patient.sex,
            phone: patient.phone,
            hasReachableContact: reachable ?? false,
          }),
  });
  const start = (preset: StartPreset) =>
    onStart && {
      run: () => {
        onStart(preset);
      },
    };

  const rowOf = (item: AttentionItem): Row => {
    switch (item.kind) {
      case 'continue': {
        const { plan } = item;
        const [first] = plan.sessions;
        const session = sessionLabel({
          sessionNumber: plan.sessions.length + 1,
          estimatedSessions: plan.estimatedSessions,
        });
        const action = start({ type: 'treatment', planIds: [plan.id] });
        return {
          key: plan.id,
          chip: target(plan),
          muted: false,
          title: plan.name,
          reason: t('record.attention.continueReason', {
            session,
            date: first ? formatCalendarDate(first.date, locale) : '',
          }),
          tag: <SessionChip label={t('clinical:flow.today.inProgress')} />,
          action: action ? { label: t('record.attention.continue'), ...action } : null,
        };
      }
      case 'treat': {
        const { plan, diagnosis } = item;
        const planned = t('record.attention.treatReason', {
          date: formatDate(plan.recordedAt, { timeZone: tenant.timeZone, locale }),
        });
        const action = start({ type: 'treatment', planIds: [plan.id] });
        return {
          key: plan.id,
          chip: target(plan),
          muted: false,
          title: plan.name,
          reason: diagnosis ? `${diagnosis.name} · ${planned}` : planned,
          tag: <PriorityChip priority="urgent" />,
          action: action ? { label: t('record.attention.treat'), ...action } : null,
        };
      }
      case 'balance':
        return {
          key: 'balance',
          chip: t('record.attention.moneySign'),
          muted: true,
          title: t('record.attention.balance'),
          reason: t('record.attention.balanceReason', {
            amount: formatMoney(item.owed, locale),
          }),
          tag: <PriorityChip priority="high" />,
          action: openPayment
            ? {
                label: t('record.attention.recordPayment'),
                run: () => {
                  openPayment({ patientId: patient.id });
                },
              }
            : null,
        };
      case 'examination': {
        const action = start({ type: 'examination' });
        return {
          key: 'examination',
          chip: '—',
          muted: true,
          title: t('record.attention.examination'),
          reason: t('record.attention.examinationReason'),
          tag: <PriorityChip priority="high" />,
          action: action ? { label: t('record.attention.startExamination'), ...action } : null,
        };
      }
      case 'details':
        return {
          key: 'details',
          chip: '—',
          muted: true,
          title: t('record.attention.details'),
          reason: formatList(
            item.missing.map((field) => t(`missingInformation.${field}`)),
            locale,
          ),
          tag: null,
          action: onCompleteDetails
            ? { label: t('record.attention.completeDetails'), run: onCompleteDetails }
            : null,
        };
    }
  };
  const rows = items.map(rowOf);
  const loading =
    (canVisits && (chart.isPending || lastVisit.isPending)) || (canPay && balance.isPending);

  return (
    <section
      aria-labelledby={titleId}
      className="overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="border-b border-inner-divider px-4 py-3.5">
        <h2 id={titleId} className="m-0 text-[14px] leading-none font-semibold">
          {t('record.attention.title')}
        </h2>
      </div>
      <ul className="m-0 list-none p-0">
        {rows.map((row) => (
          <li
            key={row.key}
            data-attention={row.key}
            className="flex flex-wrap items-center gap-3 border-t border-row-divider px-4 py-3 first:border-t-0"
          >
            <span
              dir="ltr"
              className={cn(
                'grid h-8 min-w-10 flex-none place-items-center rounded-md border px-1.5 font-mono text-[12.5px] leading-none font-bold',
                row.muted
                  ? 'border-border bg-faint text-ink-muted'
                  : 'border-primary-tint-border bg-primary-tint text-primary',
              )}
            >
              {row.chip}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] leading-[1.3] font-semibold">{row.title}</div>
              <div className="mt-[3px] text-[12.5px] leading-[1.4] text-ink-tertiary">
                {row.reason}
              </div>
            </div>
            {row.tag}
            {row.action && (
              <button
                type="button"
                onClick={row.action.run}
                className="h-[30px] flex-none cursor-pointer rounded-[7px] border border-primary bg-surface px-3 text-[12.5px] leading-none font-semibold whitespace-nowrap text-primary hover:bg-selected"
              >
                {row.action.label}
              </button>
            )}
          </li>
        ))}
      </ul>
      {rows.length === 0 && (
        <p className="m-0 p-4 text-[12.5px] leading-[1.4] text-ink-muted">
          {loading ? t('record.attention.loading') : t('record.attention.none')}
        </p>
      )}
    </section>
  );
}
