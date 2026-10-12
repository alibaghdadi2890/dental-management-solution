import type { Patient, Session, ToothCode, ToothState } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardSkeleton } from '@/components/ui/card';
import { usePermission } from '@/features/auth/use-permission';
import { BalanceCard } from '@/features/billing/balance-card';
import { DentalChart } from '@/features/clinical/chart/dental-chart';
import { useLevelLabel, useToothLabel } from '@/features/clinical/chart/use-chart-settings';
import { ToothHistoryDialog } from '@/features/clinical/dialogs/tooth-history-dialog';
import { PlanOverviewCard } from '@/features/clinical/record/plan-overview-card';
import type { StartPreset } from '@/features/clinical/start-visit-popover';
import { chartQuery, lastVisitQuery } from '@/features/clinical/visits-api';
import { LatestImagesCard } from '@/features/files/file-rows';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { NeedsAttentionCard } from './needs-attention-card';

type Tenant = NonNullable<Session['tenant']>;

const NONE = '—';

/** A card's load failure, in place of its body. */
function Failed({ children }: { children: string }) {
  return (
    <p role="alert" className="m-0 text-[12.5px] leading-snug text-ink-muted">
      {children}
    </p>
  );
}

const MICRO =
  'mb-[5px] text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal';

/**
 * The Last visit card (spec §Tab: Overview): the most recently completed visit's date, dentist,
 * duration and total, its services as chips ("Composite filling · #16", or "· Jaw" for a
 * jaw-level one) and its clinical note as a quote. Without a completed visit, dashes and "No
 * visits recorded yet." "All visits →" opens the Visits & history tab.
 */
function LastVisitCard({
  patientId,
  locale,
  onAllVisits,
}: {
  patientId: string;
  locale: string;
  onAllVisits: () => void;
}) {
  const { t } = useTranslation('patients');
  const label = useToothLabel();
  const levelLabel = useLevelLabel();
  const lastVisit = useQuery(lastVisitQuery(patientId));

  let body: ReactNode;
  if (lastVisit.isPending) {
    body = <CardSkeleton label={t('record.lastVisit.loading')} />;
  } else if (lastVisit.isError) {
    body = <Failed>{t('record.lastVisit.failed')}</Failed>;
  } else {
    const visit = lastVisit.data;
    const facts = [
      {
        key: 'date',
        value: visit ? formatCalendarDate(visit.date, locale) : NONE,
        className: 'font-medium',
      },
      { key: 'dentist', value: visit?.dentistName ?? NONE, className: 'font-medium' },
      {
        key: 'duration',
        value: visit ? t('record.lastVisit.minutes', { minutes: visit.durationMinutes }) : NONE,
        className: 'font-mono font-medium',
      },
      {
        key: 'total',
        value: visit ? formatMoney(visit.total, locale) : NONE,
        className: 'font-mono font-semibold tabular-nums',
      },
    ] as const;
    const note = visit ? visit.notes.trim() : t('record.lastVisit.none');
    body = (
      <>
        <dl className="m-0 mb-3.5 flex flex-wrap gap-[26px]">
          {facts.map((fact) => (
            <div key={fact.key}>
              <dt className={MICRO}>{t(`record.lastVisit.${fact.key}`)}</dt>
              <dd className={cn('m-0 text-[13px] leading-none', fact.className)}>{fact.value}</dd>
            </div>
          ))}
        </dl>
        {visit && visit.services.length > 0 && (
          <ul
            aria-label={t('record.lastVisit.services')}
            className="m-0 mb-3 flex list-none flex-wrap gap-[7px] p-0"
          >
            {visit.services.map((service, index) => (
              <li
                key={index}
                className="rounded-md border border-border bg-faint px-[9px] py-[5px] text-[12.5px] leading-none font-medium text-ink-secondary"
              >
                {t('record.lastVisit.chip', {
                  name: service.name,
                  target:
                    service.toothCode === null ? levelLabel(service.jaw) : label(service.toothCode),
                })}
              </li>
            ))}
          </ul>
        )}
        {note && (
          <blockquote className="m-0 rounded-e-md border-s-2 border-border-strong bg-faint px-[13px] py-[11px] text-[12.5px] leading-[1.6] whitespace-pre-line text-ink-secondary">
            {note}
          </blockquote>
        )}
      </>
    );
  }
  return (
    <Card
      title={t('record.lastVisit.title')}
      action={
        <button
          type="button"
          onClick={onAllVisits}
          className="cursor-pointer text-[12.5px] font-medium text-primary hover:underline"
        >
          {t('record.lastVisit.all')}
        </button>
      }
    >
      {body}
    </Card>
  );
}

/**
 * The Dental status card (spec §Tab: Overview): the patient's chart at 8 px cells, read-only —
 * charting happens only in a visit — where a click on a tooth opens its history.
 */
function DentalStatusCard({
  patientId,
  onOpenHistory,
}: {
  patientId: string;
  onOpenHistory: (code: ToothCode) => void;
}) {
  const { t } = useTranslation('patients');
  const chart = useQuery(chartQuery(patientId));
  const teeth = useMemo(
    () => new Map<ToothCode, ToothState>(chart.data?.teeth.map((tooth) => [tooth.code, tooth])),
    [chart.data],
  );
  return (
    <Card
      title={t('record.dental.title')}
      action={
        <span className="text-[12.5px] leading-none text-ink-muted">{t('record.dental.hint')}</span>
      }
    >
      {chart.data ? (
        <DentalChart
          teeth={teeth}
          dentition={chart.data.dentition.stage}
          size={8}
          onToothClick={onOpenHistory}
        />
      ) : chart.isError ? (
        <Failed>{t('record.dental.failed')}</Failed>
      ) : (
        <CardSkeleton label={t('record.dental.loading')} />
      )}
    </Card>
  );
}

/**
 * The record's Overview (feature 10, V11): what to do for this patient, and the record at a
 * glance, in two columns of three cards. Left: **Needs attention**, the Last visit and the
 * Latest images. Right: the Treatment plan by priority, the Balance (`payment:read` only) and
 * the Dental status — a tooth clicked there opens its history. The cards about visits need
 * `visit:read` and the images `file:read`; without them their card is left out.
 */
export function OverviewTab({
  patient,
  tenant,
  locale,
  onStart,
  onAllVisits,
  onAllFiles,
  onOpenPlan,
}: {
  patient: Patient;
  tenant: Tenant;
  locale: string;
  /** A Needs attention action that starts a visit; left out when the caller may not. */
  onStart: ((preset: StartPreset) => void) | undefined;
  /** The Last visit card's "All visits →": the Visits & history tab. */
  onAllVisits: () => void;
  /** The Latest images card's "All n →": the Files tab. */
  onAllFiles: () => void;
  /** The Treatment plan card's "Open plan →": the Treatment plan tab. */
  onOpenPlan: () => void;
}) {
  const canPay = usePermission('payment:read');
  const canVisits = usePermission('visit:read');
  const canFiles = usePermission('file:read');
  const [historyTooth, setHistoryTooth] = useState<ToothCode | null>(null);
  return (
    <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr))]">
      <div className="flex min-w-0 flex-col gap-4">
        <NeedsAttentionCard patient={patient} tenant={tenant} onStart={onStart} />
        {canVisits && (
          <LastVisitCard patientId={patient.id} locale={locale} onAllVisits={onAllVisits} />
        )}
        {canFiles && <LatestImagesCard patientId={patient.id} onViewAll={onAllFiles} />}
      </div>
      {(canPay || canVisits) && (
        <div className="flex min-w-0 flex-col gap-4">
          {canVisits && <PlanOverviewCard patientId={patient.id} onOpenPlan={onOpenPlan} />}
          {canPay && (
            <BalanceCard patientId={patient.id} currency={tenant.currency} locale={locale} />
          )}
          {canVisits && <DentalStatusCard patientId={patient.id} onOpenHistory={setHistoryTooth} />}
        </div>
      )}
      {canVisits && (
        <ToothHistoryDialog
          patientId={patient.id}
          patientName={patient.fullName}
          code={historyTooth}
          onCodeChange={setHistoryTooth}
          canStart={patient.archivedAt === null}
        />
      )}
    </div>
  );
}
