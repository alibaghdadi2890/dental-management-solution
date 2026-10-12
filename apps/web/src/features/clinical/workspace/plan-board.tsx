import {
  isPrimary,
  type Jaw,
  type PatientChart,
  planPhases,
  type PlanPriority,
  type ToothCode,
  type ToothNotation,
  toUniversal,
  type TreatmentPlan,
} from '@dcm/contracts';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { openPrintable, printPath } from '@/features/billing/payments-api';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useChartSettings,
  useLevelLabel,
  useToothLabel,
  useToothName,
} from '../chart/use-chart-settings';
import { useChartingActions } from './charting-actions';
import { PlanDismiss } from './tooth-panel/plan-section';
import { SurfaceTag } from './tooth-panel/surface-tag';
import { plansTotal } from './tooth-panel/tooth-records';
import { useToothSelection } from './tooth-selection';

/** Each phase's label, in its tone. */
const PHASE_LABEL: Record<PlanPriority, string> = {
  urgent: 'text-danger',
  high: 'text-warning',
  elective: 'text-ink-secondary',
};

/** One tooth's open plans, or one level's (a jaw, or the whole mouth when both are null). */
interface TargetPlans {
  tooth: ToothCode | null;
  jaw: Jaw | null;
  plans: TreatmentPlan[];
}

/** What a target is keyed and marked by: the tooth code, the jaw, or `mouth`. */
const targetKey = (target: Pick<TargetPlans, 'tooth' | 'jaw'>) =>
  target.tooth ?? target.jaw ?? 'mouth';

/** A tooth's place in the clinic's numbering: permanent teeth first, then primary; FDI by its
 * number, Universal by its number (1–32) or letter (A–T), as the POC orders its board. */
function numberingRank(code: ToothCode, notation: ToothNotation): [number, number] {
  const kind = isPrimary(code) ? 1 : 0;
  if (notation === 'fdi') return [kind, Number(code)];
  const universal = toUniversal(code);
  return [kind, isPrimary(code) ? universal.charCodeAt(0) : Number(universal)];
}

/** Plans by tooth in numbering order, then the upper jaw, the lower jaw and the whole mouth. */
function byTarget(plans: readonly TreatmentPlan[], notation: ToothNotation): TargetPlans[] {
  const targets = new Map<string, TargetPlans>();
  for (const plan of plans) {
    const key = targetKey({ tooth: plan.toothCode, jaw: plan.jaw });
    const target = targets.get(key) ?? { tooth: plan.toothCode, jaw: plan.jaw, plans: [] };
    target.plans.push(plan);
    targets.set(key, target);
  }
  const rank = ({ tooth, jaw }: TargetPlans): [number, number] =>
    tooth === null
      ? [2, jaw === 'upper' ? 0 : jaw === 'lower' ? 1 : 2]
      : numberingRank(tooth, notation);
  return [...targets.values()].sort((a, b) => {
    const [kindA, numberA] = rank(a);
    const [kindB, numberB] = rank(b);
    return kindA - kindB || numberA - numberB;
  });
}

/**
 * The Treatment plan card (spec §Visit Workspace → Body 2): the patient's planned procedures,
 * whichever visit recorded them, by priority — the phases of the plan (feature 10, ADR-0045),
 * each under its label and total — then by tooth (the jaws and the whole mouth last). Work that was
 * started and not finished is a service, not a plan (ADR-0032): it is not listed here. Each
 * target's 128px column holds the tooth label — a link that selects the tooth — its anatomical
 * name and its active diagnoses (`danger`, or "No diagnosis recorded"; a jaw or whole-mouth row
 * shows only its level); beside it the plan rows with name, surfaces and price. The footer band
 * carries the plan estimate.
 *
 * In a visit a planned row offers **Perform now** (the tooth panel's own action: same toast, same
 * Undo); on the patient record it offers **Remove** or **Cancel**. Read-only without the scope's
 * write permission.
 */
export function PlanBoard({ chart, canWrite }: { chart: PatientChart; canWrite: boolean }) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const { notation } = useChartSettings();
  const titleId = useId();
  const open = chart.plans.filter((plan) => plan.status === 'planned');
  const total = plansTotal(open);
  const teeth = new Set(open.flatMap((plan) => plan.toothCode ?? [])).size;
  const [patientId] = [open[0]?.patientId];

  return (
    <section
      aria-labelledby={titleId}
      className="mb-4 overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center gap-[9px] border-b border-inner-divider px-4 py-3.5">
        <h2 id={titleId} className="m-0 text-[14px] leading-none font-semibold">
          {t('planBoard.title')}
        </h2>
        {open.length > 0 && (
          <span className="ms-auto text-[12.5px] leading-none text-ink-muted">
            {t('planBoard.countLine', {
              teeth: t('planBoard.teeth', { count: teeth }),
              procedures: t('planBoard.procedures', { count: open.length }),
            })}
          </span>
        )}
      </div>
      {planPhases(open).map(
        (phase) =>
          phase.total && (
            <div
              key={phase.priority}
              role="group"
              aria-label={t(`flow.priority.${phase.priority}`)}
            >
              <div className="flex items-baseline justify-between border-b border-row-divider bg-faint px-4 py-2">
                <h3
                  className={cn(
                    'm-0 text-[11.5px] leading-none font-semibold tracking-[.05em] uppercase [&:lang(ar)]:tracking-normal',
                    PHASE_LABEL[phase.priority],
                  )}
                >
                  {t(`flow.priority.${phase.priority}`)}
                </h3>
                <span
                  dir="ltr"
                  className="font-mono text-[13px] leading-none font-semibold tabular-nums"
                >
                  {formatMoney(phase.total, locale)}
                </span>
              </div>
              {byTarget(phase.open, notation).map((target) => (
                <TargetRow
                  key={targetKey(target)}
                  target={target}
                  chart={chart}
                  canWrite={canWrite}
                />
              ))}
            </div>
          ),
      )}
      {total ? (
        <div className="flex items-baseline justify-between gap-3 bg-sunken px-4 py-3">
          <span className="text-[12.5px] leading-none font-semibold">
            {t('planBoard.estimate')}
          </span>
          {patientId !== undefined && (
            <button
              type="button"
              onClick={() => {
                openPrintable(printPath.quote(patientId));
              }}
              className="ms-auto cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-medium text-primary hover:underline"
            >
              {t('planBoard.quote')}
            </button>
          )}
          <span
            dir="ltr"
            className="font-mono text-[17px] leading-none font-bold tracking-[-0.02em] tabular-nums"
          >
            {formatMoney(total, locale)}
          </span>
        </div>
      ) : (
        <div className="px-[18px] py-6 text-center">
          <h3 className="m-0 text-[13px] leading-[1.3] font-semibold">
            {t('planBoard.emptyTitle')}
          </h3>
        </div>
      )}
    </section>
  );
}

function TargetRow({
  target,
  chart,
  canWrite,
}: {
  target: TargetPlans;
  chart: PatientChart;
  canWrite: boolean;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const actions = useChartingActions();
  const { select } = useToothSelection();
  const toothLabel = useToothLabel();
  const toothName = useToothName();
  const levelLabel = useLevelLabel();
  const { tooth } = target;
  const inVisit = actions.scope.kind === 'visit';
  const diagnoses =
    tooth === null
      ? []
      : chart.diagnoses.filter(
          (record) => record.toothCode === tooth && record.status === 'active',
        );

  return (
    <div
      data-tooth={targetKey(target)}
      className="flex flex-wrap items-start gap-3 border-b border-row-divider px-4 py-3"
    >
      <div className="flex-[0_0_128px]">
        {tooth === null ? (
          <span className="text-[14px] leading-[1.2] font-bold text-primary">
            {levelLabel(target.jaw)}
          </span>
        ) : (
          <button
            type="button"
            dir="ltr"
            title={t('planBoard.selectTooth', { label: toothLabel(tooth) })}
            onClick={() => {
              select(tooth);
            }}
            className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[15px] leading-[1.1] font-bold text-primary hover:underline"
          >
            {toothLabel(tooth)}
          </button>
        )}
        {tooth !== null && (
          <>
            <div className="mt-0.5 text-[12.5px] leading-[1.4] text-ink-tertiary">
              {toothName(tooth)}
            </div>
            <div
              className={cn(
                'text-[12.5px] leading-[1.4]',
                diagnoses.length > 0 ? 'text-danger' : 'text-ink-muted',
              )}
            >
              {diagnoses.length > 0
                ? diagnoses.map((record) => record.name).join(t('title.listSeparator'))
                : t('planBoard.noDiagnosis')}
            </div>
          </>
        )}
      </div>
      <ul className="m-0 flex min-w-0 flex-[1_1_260px] list-none flex-col gap-[7px] p-0">
        {target.plans.map((plan) => {
          const price = formatMoney(plan.price, locale);
          return (
            <li
              key={plan.id}
              className="flex flex-wrap items-center gap-2.5 rounded-[7px] border border-planned-border bg-planned-bg px-[11px] py-[9px]"
            >
              <span className="min-w-0 flex-1 text-[12.5px] leading-[1.35] font-semibold">
                {plan.name}
              </span>
              <SurfaceTag surfaces={plan.surfaces} className="text-warning" />
              <span
                dir="ltr"
                className="font-mono text-[13px] leading-none font-semibold tabular-nums"
              >
                {price}
              </span>
              {canWrite && inVisit && (
                <button
                  type="button"
                  title={t('panel.plan.performTitle', { price })}
                  aria-label={t('panel.plan.performNamed', { name: plan.name })}
                  onClick={() => {
                    actions.performPlan(plan);
                  }}
                  className="flex h-7 flex-none cursor-pointer items-center gap-1.5 rounded-md border-0 bg-primary px-[11px] text-[12.5px] leading-none font-semibold text-primary-foreground hover:bg-primary-hover"
                >
                  {t('panel.plan.perform')}
                </button>
              )}
              {canWrite && !inVisit && <PlanDismiss plan={plan} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
