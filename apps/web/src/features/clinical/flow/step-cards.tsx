import { isOpenPlan, type PatientChart, planPhases } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CardSkeleton } from '@/components/ui/card';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { lastVisitQuery } from '../visits-api';
import { plansTotal } from '../workspace/tooth-panel/tooth-records';
import { useSessionLabel } from './flow-labels';
import { EMPTY_LINE } from './flow-styles';
import { PriorityChip, SessionChip } from './priority-chip';
import { useTargetLabel } from './use-target-label';
import { sessionNumberIn } from './visit-facts';

/** A step screen's card: white, bordered, a 14px title with something at its other end. */
function StepCard({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn('rounded-xl border border-border bg-surface px-[18px] py-4', className)}
    >
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 className="m-0 text-[14px] leading-none font-semibold">{title}</h2>
        {aside !== undefined && <span className="ms-auto">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** A line of a step card's list: the tooth or level in Mono, then what it is. */
function TargetLine({ target, children }: { target: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 border-t border-row-divider py-[7px] text-[12.5px] leading-[1.35]">
      <span dir="ltr" className="w-[38px] flex-none font-mono font-semibold text-primary">
        {target}
      </span>
      {children}
    </li>
  );
}

/**
 * The **Last visit** card of Intake and Complaint (feature 10, V3, V4): the patient's last
 * completed visit — its date, type and dentist, what was done, its notes.
 */
export function LastVisitCard({ patientId }: { patientId: string }) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const target = useTargetLabel();
  const lastVisit = useQuery(lastVisitQuery(patientId));
  const visit = lastVisit.data;
  return (
    <StepCard
      title={t('flow.lastVisit.title')}
      aside={
        visit && (
          <span className="font-mono text-[12.5px] leading-none text-ink-muted">
            {formatCalendarDate(visit.date, locale)}
          </span>
        )
      }
    >
      {lastVisit.isPending ? (
        <CardSkeleton label={t('workspace.loading')} />
      ) : lastVisit.isError ? (
        <p role="alert" className={EMPTY_LINE}>
          {t('flow.lastVisit.failed')}
        </p>
      ) : !visit ? (
        <p className={EMPTY_LINE}>{t('flow.lastVisit.none')}</p>
      ) : (
        <>
          <p className="m-0 mb-1.5 text-[12.5px] leading-[1.4] text-ink-muted">
            {t('flow.lastVisit.line', {
              type: t(`flow.types.${visit.type}`),
              dentist: visit.dentistName,
            })}
          </p>
          {visit.reason && (
            <p className="m-0 mb-1.5 text-[12.5px] leading-[1.45] text-ink-secondary">
              {visit.reason}
            </p>
          )}
          <ul className="m-0 list-none p-0">
            {visit.services.map((service, index) => (
              <TargetLine key={index} target={target(service)}>
                <span className="min-w-0 flex-1">{service.name}</span>
              </TargetLine>
            ))}
          </ul>
          {visit.notes.trim() !== '' && (
            <p className="m-0 mt-2 text-[12.5px] leading-[1.55] whitespace-pre-line text-ink-secondary">
              {visit.notes.trim()}
            </p>
          )}
        </>
      )}
    </StepCard>
  );
}

/**
 * Intake's **Open treatment** card (V3): everything still to do, work in progress first, then
 * by priority, with its total.
 */
export function OpenTreatmentCard({
  chart,
  visitId,
}: {
  chart: PatientChart | undefined;
  visitId: string;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const target = useTargetLabel();
  const sessionLabel = useSessionLabel();
  const open = planPhases(chart?.plans ?? []).flatMap((phase) => phase.open);
  // Work in progress leads, whatever its phase.
  const rows = [
    ...open.filter((plan) => plan.status === 'in_progress'),
    ...open.filter((plan) => plan.status === 'planned'),
  ];
  const total = plansTotal(rows.filter(isOpenPlan));
  return (
    <StepCard
      title={t('flow.openTreatment.title')}
      aside={
        total && (
          <span dir="ltr" className="font-mono text-[13px] leading-none font-semibold text-warning">
            {formatMoney(total, locale)}
          </span>
        )
      }
    >
      {chart === undefined ? (
        <CardSkeleton label={t('workspace.loading')} />
      ) : rows.length === 0 ? (
        <p className={EMPTY_LINE}>{t('flow.openTreatment.none')}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {rows.map((plan) => {
            const session =
              plan.status === 'in_progress'
                ? sessionLabel({
                    sessionNumber: sessionNumberIn(plan, visitId),
                    estimatedSessions: plan.estimatedSessions,
                  })
                : null;
            return (
              <TargetLine key={plan.id} target={target(plan)}>
                <span className="min-w-0 flex-1">{plan.name}</span>
                {session === null ? (
                  <PriorityChip priority={plan.priority} />
                ) : (
                  <SessionChip label={session} />
                )}
                <span dir="ltr" className="w-[60px] flex-none text-end font-mono font-medium">
                  {formatMoney(plan.price, locale)}
                </span>
              </TargetLine>
            );
          })}
        </ul>
      )}
    </StepCard>
  );
}
