import {
  type DiagnosisRecord,
  type Patient,
  PLAN_PRIORITIES,
  type PlanPhase,
  planPhases,
  type PlanPriority,
  toCents,
  type TreatmentPlan,
} from '@dcm/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CardSkeleton } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/list';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { accountQuery, openPrintable, printPath } from '@/features/billing/payments-api';
import { useRecordPayment } from '@/features/billing/payments/payment-dialog-context';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PlanStatusPill } from '../flow/plan-status-pill';
import { useTargetLabel } from '../flow/use-target-label';
import { chartQuery } from '../visits-api';
import { SurfaceTag } from '../workspace/tooth-panel/surface-tag';
import { usePatientRecordMutations } from './patient-records-api';

const GRID =
  'grid grid-cols-[64px_minmax(180px,1.4fr)_minmax(140px,1fr)_104px_128px_92px_124px] items-center gap-3 px-[18px]';
const TONE: Record<PlanPriority, { rule: string; label: string }> = {
  urgent: { rule: 'border-t-danger', label: 'text-danger' },
  high: { rule: 'border-t-warning', label: 'text-warning' },
  elective: { rule: 'border-t-ink-muted', label: 'text-ink-secondary' },
};

/**
 * The record's **Treatment plan** tab (feature 10, V12; ADR-0045): the plan as its three phases.
 * Each phase has a header — how many items, how many done, what is still to pay for, and
 * **Quote**, which prints that phase alone — over a table: tooth, treatment with its surfaces,
 * the diagnosis it is *for*, its status, whether the patient accepted it, its price and its
 * priority. Changing the priority moves the row to the other phase; a done row stays in its
 * phase, dimmed, last. Accepting and prioritising need `chart:write` on a live record. With
 * `payment:read`, money paid in advance for the plan (ADR-0051) is shown over the phases, with
 * what is still to pay; with `payment:write` and open plan work, **Pay in advance**.
 */
export function TreatmentPlanTab({ patient }: { patient: Patient }) {
  const { t } = useTranslation('clinical');
  const chart = useQuery(chartQuery(patient.id));
  const canWrite =
    usePermission('chart:write') && patient.archivedAt === null && patient.mergedIntoId === null;
  if (!chart.data) {
    return (
      <section className="rounded-xl border border-border bg-surface px-[18px] py-4">
        {chart.isError ? (
          <ErrorState
            title={t('planTab.failed')}
            body={t('workspace.failedBody')}
            onRetry={() => void chart.refetch()}
          />
        ) : (
          <CardSkeleton label={t('workspace.loading')} />
        )}
      </section>
    );
  }
  const phases = planPhases(chart.data.plans);
  const empty = phases.every((phase) => phase.open.length + phase.done.length === 0);
  return (
    <div className="flex flex-col gap-4">
      <PaidInAdvance
        patientId={patient.id}
        canPay={patient.archivedAt === null && patient.mergedIntoId === null}
      />
      {empty && (
        <p className="m-0 rounded-xl border border-border bg-surface px-[18px] py-4 text-[12.5px] leading-[1.45] text-ink-muted">
          {t('planTab.empty')}
        </p>
      )}
      {phases.map((phase) => (
        <Phase
          key={phase.priority}
          patientId={patient.id}
          phase={phase}
          diagnoses={chart.data.diagnoses}
          canWrite={canWrite}
        />
      ))}
    </div>
  );
}

/**
 * "Paid in advance" and "Still to pay" (ADR-0051), when the patient holds money for the plan:
 * still to pay is what the plan still needs (`planRemaining`), the cap of a plan advance.
 */
function PaidInAdvance({
  patientId,
  canPay,
}: {
  patientId: string;
  /** The record is live: an advance may be taken. */
  canPay: boolean;
}) {
  const { t, i18n } = useTranslation(['clinical', 'billing']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const canRead = usePermission('payment:read');
  const openPayment = useRecordPayment();
  const account = useQuery({ ...accountQuery(patientId), enabled: canRead });
  const payButton =
    openPayment && canPay && account.data?.planRemaining != null ? (
      <Button
        variant="secondary"
        size="sm"
        className="ms-auto"
        onClick={() => {
          openPayment({ patientId, advance: true });
        }}
      >
        {t('billing:record.advance.start')}
      </Button>
    ) : null;
  if (!account.data) return null;
  if (toCents(account.data.held) <= 0n) {
    return payButton ? <div className="flex">{payButton}</div> : null;
  }
  const { held, currency, planRemaining } = account.data;
  const money = (amount: string) => formatMoney({ amount, currency }, locale);
  return (
    <section
      aria-label={t('planTab.paidInAdvance')}
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-success-border bg-success-bg px-[18px] py-3.5"
    >
      <span className="flex items-baseline gap-2">
        <span className="text-[12.5px] font-medium text-success">{t('planTab.paidInAdvance')}</span>
        <span dir="ltr" className="font-mono text-[15px] font-bold text-success tabular-nums">
          {money(held)}
        </span>
      </span>
      <span className="flex items-baseline gap-2">
        <span className="text-[12.5px] font-medium text-ink-secondary">
          {t('planTab.stillToPay')}
        </span>
        <span dir="ltr" className="font-mono text-[15px] font-bold tabular-nums">
          {money(planRemaining ?? '0')}
        </span>
      </span>
      <span className="text-[12px] leading-snug text-ink-muted">{t('planTab.advanceHint')}</span>
      {payButton}
    </section>
  );
}

function Phase({
  patientId,
  phase,
  diagnoses,
  canWrite,
}: {
  patientId: string;
  phase: PlanPhase<TreatmentPlan>;
  diagnoses: readonly DiagnosisRecord[];
  canWrite: boolean;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const rows = [...phase.open, ...phase.done];
  const label = t(`flow.priority.${phase.priority}`);
  return (
    <section
      aria-label={label}
      data-phase={phase.priority}
      className={cn(
        'overflow-hidden rounded-xl border border-t-[3px] border-border bg-surface',
        TONE[phase.priority].rule,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-[18px] py-3.5">
        <h2
          className={cn(
            'm-0 text-[12.5px] leading-none font-semibold tracking-[.05em] uppercase [&:lang(ar)]:tracking-normal',
            TONE[phase.priority].label,
          )}
        >
          {label}
        </h2>
        <span className="text-[12.5px] leading-none text-ink-muted">
          {t('planTab.counts', {
            items: t('flow.phase.items', { count: rows.length }),
            done: phase.done.length,
          })}
        </span>
        <span className="ms-auto flex items-center gap-3.5">
          {phase.total && (
            <span dir="ltr" className="font-mono text-[15px] leading-none font-bold tabular-nums">
              {formatMoney(phase.total, locale)}
            </span>
          )}
          {phase.open.length > 0 && (
            <button
              type="button"
              aria-label={t('planTab.quoteOf', { phase: label })}
              onClick={() => {
                openPrintable(printPath.quote(patientId, phase.priority));
              }}
              className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-medium text-primary hover:underline"
            >
              {t('planBoard.quote')}
            </button>
          )}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="m-0 border-t border-row-divider px-[18px] py-3.5 text-[12.5px] leading-[1.4] text-ink-muted">
          {t('flow.phase.none')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div
            role="table"
            aria-label={t('planTab.tableOf', { phase: label })}
            className="min-w-[940px]"
          >
            <div
              role="row"
              className={cn(
                GRID,
                'h-9 border-y border-border bg-faint text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal',
              )}
            >
              <span role="columnheader">{t('flow.findings.tooth')}</span>
              <span role="columnheader">{t('planTab.treatment')}</span>
              <span role="columnheader">{t('planTab.for')}</span>
              <span role="columnheader">{t('planTab.status')}</span>
              <span role="columnheader">{t('planTab.patient')}</span>
              <span role="columnheader" className="text-end">
                {t('planTab.price')}
              </span>
              <span role="columnheader">{t('flow.proposal.priority')}</span>
            </div>
            {rows.map((plan) => (
              <PlanRow
                key={plan.id}
                patientId={patientId}
                plan={plan}
                diagnosis={diagnoses.find((record) => record.id === plan.diagnosisRecordId)}
                canWrite={canWrite}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PlanRow({
  patientId,
  plan,
  diagnosis,
  canWrite,
}: {
  patientId: string;
  plan: TreatmentPlan;
  diagnosis: DiagnosisRecord | undefined;
  canWrite: boolean;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const target = useTargetLabel();
  const mutations = usePatientRecordMutations(patientId);
  const accept = useMutation(mutations.setAcceptance);
  const update = useMutation(mutations.updatePlan);
  const done = plan.status === 'performed';
  const accepted = plan.acceptedAt !== null;
  const busy = accept.isPending || update.isPending;
  const onError = (error: unknown) => {
    toast(t('actions.failed', { reason: apiErrorMessage(error, i18n) }), { tone: 'danger' });
  };
  // Once the work has begun it was agreed to: only a plan still planned takes it back.
  const canToggle = canWrite && !done && (!accepted || plan.status === 'planned');

  return (
    <div
      role="row"
      data-plan={plan.id}
      className={cn(
        GRID,
        'min-h-[50px] border-t border-row-divider py-2 first:border-t-0',
        done && 'opacity-55',
      )}
    >
      <span
        role="cell"
        dir="ltr"
        className="font-mono text-[13px] leading-none font-bold text-primary rtl:text-end"
      >
        {target(plan)}
      </span>
      <span role="cell" className="min-w-0 text-[13px] leading-[1.35] font-semibold">
        {plan.name}
        <SurfaceTag surfaces={plan.surfaces} className="ms-[7px] text-warning" />
      </span>
      <span
        role="cell"
        className={cn(
          'min-w-0 text-[12.5px] leading-[1.4]',
          diagnosis ? 'text-danger' : 'text-ink-muted',
        )}
      >
        {diagnosis?.name ?? '—'}
      </span>
      <span role="cell">
        <PlanStatusPill plan={plan} />
      </span>
      <span role="cell" className="text-[12.5px] leading-none">
        {accepted ? (
          canToggle ? (
            <button
              type="button"
              disabled={busy}
              title={t('planTab.withdraw')}
              aria-label={t('planTab.withdrawNamed', { name: plan.name })}
              onClick={() => {
                accept.mutate({ planId: plan.id, accepted: false }, { onError });
              }}
              className="cursor-pointer border-0 bg-transparent p-0 font-medium text-success hover:underline"
            >
              {t('planTab.accepted')}
            </button>
          ) : (
            <span className="font-medium text-success">{t('planTab.accepted')}</span>
          )
        ) : canToggle ? (
          <button
            type="button"
            disabled={busy}
            aria-label={t('planTab.acceptNamed', { name: plan.name })}
            onClick={() => {
              accept.mutate({ planId: plan.id, accepted: true }, { onError });
            }}
            className="cursor-pointer border-0 bg-transparent p-0 font-medium text-primary hover:underline"
          >
            {t('planTab.markAccepted')}
          </button>
        ) : (
          <span className="text-ink-muted">{t('planTab.proposed')}</span>
        )}
      </span>
      <span
        role="cell"
        dir="ltr"
        className="text-end font-mono text-[13px] leading-none font-semibold tabular-nums"
      >
        {formatMoney(plan.price, locale)}
      </span>
      <span role="cell">
        {canWrite && !done ? (
          <select
            aria-label={t('flow.proposal.priorityOf', { name: plan.name })}
            value={plan.priority}
            disabled={busy}
            onChange={(event) => {
              const priority = PLAN_PRIORITIES.find((value) => value === event.target.value);
              if (priority) update.mutate({ planId: plan.id, patch: { priority } }, { onError });
            }}
            className="h-8 w-full rounded-md border border-border-control bg-surface px-1.5 text-[12.5px] leading-none"
          >
            {PLAN_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {t(`flow.priority.${priority}`)}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[12.5px] leading-none text-ink-secondary">
            {t(`flow.priority.${plan.priority}`)}
          </span>
        )}
      </span>
    </div>
  );
}
