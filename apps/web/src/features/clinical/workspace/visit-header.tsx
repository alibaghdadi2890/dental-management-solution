import type { Patient, PatientChart, Session, Visit } from '@dcm/contracts';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { Pill } from '@/components/ui/list';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { useToast } from '@/components/ui/toast-context';
import { useStaffNames } from '@/features/users/use-staff-names';
import { ApiError } from '@/lib/api';
import { ageOrNull, formatCalendarDate, todayIn } from '@/lib/format';
import { initials } from '@/lib/initials';
import { cn } from '@/lib/utils';
import { useVisitMutations } from '../visit-mutations';
import { useVisitTimer } from '../use-visit-timer';

type Tenant = NonNullable<Session['tenant']>;

/**
 * Whether the visit has put nothing on the record yet, as far as the client can tell (the
 * discard rule, spec §Discard): no services and no notes on the visit, and no diagnosis or plan
 * recorded, resolved, performed or cancelled in it per the chart. A tooth presence change isn't
 * visible here, so the server's 409 `visit.not_empty` stays the last word.
 */
function looksEmpty(visit: Visit, chart: PatientChart): boolean {
  const inThisVisit = (visitId: string | null) => visitId === visit.id;
  return (
    visit.services.length === 0 &&
    visit.notes.trim() === '' &&
    !chart.diagnoses.some(
      (record) => inThisVisit(record.recordedInVisitId) || inThisVisit(record.resolvedInVisitId),
    ) &&
    !chart.plans.some(
      (plan) =>
        inThisVisit(plan.recordedInVisitId) ||
        inThisVisit(plan.performedInVisitId) ||
        inThisVisit(plan.cancelledInVisitId),
    )
  );
}

/**
 * The workspace header band (spec §Visit Workspace → Visit header): the patient chip back to the
 * record, the compact alert chips, then the status and date block, the timer chip (running or
 * paused), Pause / Resume and — while the visit is still empty — a menu with **Discard visit**.
 * Without `visit:write` (front desk, W18) it shows a View only badge instead of the controls.
 */
export function VisitHeader({
  visit,
  patient,
  chart,
  tenant,
  canWrite,
}: {
  visit: Visit;
  patient: Patient | undefined;
  chart: PatientChart | undefined;
  tenant: Tenant;
  canWrite: boolean;
}) {
  const { t, i18n } = useTranslation(['clinical', 'patients']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const confirm = useConfirm();
  const { dentistNames } = useStaffNames();
  const timer = useVisitTimer(visit.id);
  const mutations = useVisitMutations(visit.id);
  const pause = useMutation(mutations.pause);
  const resume = useMutation(mutations.resume);
  const discard = useMutation(mutations.discard);
  const running = visit.status === 'in_progress';
  const busy = pause.isPending || resume.isPending || discard.isPending;

  const dentist = dentistNames.get(visit.dentistId);
  const date = formatCalendarDate(visit.localDate, locale);
  const age = patient ? ageOrNull(patient.dateOfBirth, todayIn(tenant.timeZone)) : null;

  const toggle = () => {
    const [mutation, failed] = running
      ? ([pause, 'workspace.pauseFailed'] as const)
      : ([resume, 'workspace.resumeFailed'] as const);
    mutation.mutate(undefined, {
      onError: (error) => {
        toast(t(failed, { reason: error.message }), { tone: 'danger' });
      },
    });
  };

  const confirmDiscard = () => {
    confirm({
      title: t('workspace.discard.title'),
      body: t('workspace.discard.body'),
      okLabel: t('workspace.discard.confirm'),
      tone: 'danger',
      onConfirm: async () => {
        try {
          await discard.mutateAsync();
        } catch (error) {
          if (error instanceof ApiError && error.code === 'visit.not_empty') {
            throw new Error(t('workspace.discard.notEmpty'), { cause: error });
          }
          throw error;
        }
        // The cached visit is now `discarded`: the page leaves for the patient record.
        toast(t('workspace.discard.done'), { tone: 'success' });
      },
    });
  };

  return (
    <header className="flex flex-none flex-wrap items-center gap-4 border-b border-border bg-surface px-[22px] py-3">
      <Link
        to="/patients/$patientId"
        params={{ patientId: visit.patientId }}
        className="flex min-w-0 items-center gap-2 text-start hover:opacity-70"
      >
        <span
          aria-hidden
          className="grid size-[34px] flex-none place-items-center rounded-lg border border-primary-tint-border bg-primary-tint text-[12.5px] leading-none font-semibold text-primary"
        >
          {patient ? initials(patient.fullName) : ''}
        </span>
        {patient ? (
          <span className="min-w-0">
            <span className="block text-[14px] leading-[1.2] font-semibold text-ink">
              {patient.fullName}
            </span>
            <span className="block font-mono text-[12.5px] leading-[1.3] text-ink-muted">
              {t('workspace.patientLine', {
                number: patient.displayNumber,
                age:
                  age === null
                    ? t('patients:record.ageUnknown')
                    : t('patients:ageYears', { count: age }),
              })}
            </span>
          </span>
        ) : (
          <span className="flex w-40 flex-col gap-1.5" aria-label={t('workspace.loading')}>
            <span className="block h-[11px] w-[72%] rounded-[4px] bg-inner-divider" />
            <span className="block h-[11px] w-[60%] rounded-[4px] bg-row-divider" />
          </span>
        )}
      </Link>

      {patient && patient.medicalAlerts.length > 0 && (
        <ul aria-label={t('workspace.alerts')} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {patient.medicalAlerts.map((alert) => (
            <li
              key={alert}
              className="rounded-[5px] border border-warning-border bg-warning-bg px-2 py-1 text-[11.5px] leading-none font-medium text-warning"
            >
              {alert}
            </li>
          ))}
        </ul>
      )}

      <div className="ms-auto flex flex-wrap items-center gap-3.5">
        <div className="text-end">
          <div className="mb-1 text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal">
            {t(running ? 'workspace.status.inProgress' : 'workspace.status.paused')}
          </div>
          <div className="text-[12.5px] leading-none text-ink-tertiary">
            {dentist ? t('workspace.dateDentist', { date, dentist }) : date}
          </div>
        </div>
        <div
          role="timer"
          aria-label={t('workspace.timer')}
          data-state={running ? 'running' : 'paused'}
          className={cn(
            'flex items-center gap-[9px] rounded-lg border px-[13px] py-[7px]',
            running
              ? 'border-primary-tint-border bg-primary-tint text-primary'
              : 'border-border bg-subtle text-ink-tertiary',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'size-[7px] flex-none rounded-full',
              running ? 'animate-pulsedot bg-primary' : 'bg-ink-muted',
            )}
          />
          <span
            dir="ltr"
            className="font-mono text-[19px] leading-none font-semibold tracking-[-0.01em] tabular-nums"
          >
            {timer}
          </span>
        </div>
        {canWrite ? (
          <>
            <Button
              variant="outline"
              size="toolbar"
              busy={pause.isPending || resume.isPending}
              disabled={busy}
              onClick={toggle}
            >
              {t(running ? 'workspace.pause' : 'workspace.resume')}
            </Button>
            {chart && looksEmpty(visit, chart) && (
              <Menu>
                <MenuTrigger asChild>
                  <IconButton aria-label={t('workspace.actions')} disabled={busy}>
                    <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <circle cx="3" cy="8" r="1.4" />
                      <circle cx="8" cy="8" r="1.4" />
                      <circle cx="13" cy="8" r="1.4" />
                    </svg>
                  </IconButton>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem tone="danger" onSelect={confirmDiscard}>
                    {t('workspace.discard.action')}
                  </MenuItem>
                </MenuContent>
              </Menu>
            )}
          </>
        ) : (
          <Pill tone="neutral">{t('workspace.viewOnly')}</Pill>
        )}
      </div>
    </header>
  );
}
