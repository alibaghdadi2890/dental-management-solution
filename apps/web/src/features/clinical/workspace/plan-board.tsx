import {
  isPrimary,
  type PatientChart,
  type ToothCode,
  type ToothNotation,
  toUniversal,
  type TreatmentPlan,
} from '@dcm/contracts';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useChartSettings, useToothLabel, useToothName } from '../chart/use-chart-settings';
import { useChartingActions } from './charting-actions';
import { useToothSelection } from './tooth-selection';
import { SurfaceTag } from './tooth-panel/surface-tag';
import { plansTotal } from './tooth-panel/tooth-records';

/** One tooth's open plans, or the jaw-level ones (`tooth: null`). */
interface PlanGroup {
  tooth: ToothCode | null;
  plans: TreatmentPlan[];
}

/** A tooth's place in the clinic's numbering: permanent teeth first, then primary; FDI by its
 * number, Universal by its number (1–32) or letter (A–T), as the POC orders its board. */
function numberingRank(code: ToothCode, notation: ToothNotation): [number, number] {
  const kind = isPrimary(code) ? 1 : 0;
  if (notation === 'fdi') return [kind, Number(code)];
  const universal = toUniversal(code);
  return [kind, isPrimary(code) ? universal.charCodeAt(0) : Number(universal)];
}

/** The open plans grouped by tooth in numbering order, the jaw-level group last. */
function planGroups(plans: readonly TreatmentPlan[], notation: ToothNotation): PlanGroup[] {
  const byTooth = new Map<ToothCode | null, TreatmentPlan[]>();
  for (const plan of plans) {
    if (plan.status !== 'planned') continue;
    byTooth.set(plan.toothCode, [...(byTooth.get(plan.toothCode) ?? []), plan]);
  }
  const rank = (tooth: ToothCode | null): [number, number] =>
    tooth === null ? [2, 0] : numberingRank(tooth, notation);
  return [...byTooth]
    .map(([tooth, grouped]) => ({ tooth, plans: grouped }))
    .sort((a, b) => {
      const [kindA, numberA] = rank(a.tooth);
      const [kindB, numberB] = rank(b.tooth);
      return kindA - kindB || numberA - numberB;
    });
}

/**
 * The Treatment plan card (spec §Visit Workspace → Body 2): the patient's open plans, whichever
 * visit recorded them, grouped by tooth (jaw-level last). Each group's 128px column holds the
 * tooth label — a link that selects the tooth — its anatomical name and its active diagnoses
 * (`danger`, or "No diagnosis recorded"); beside it the plan rows with name, surfaces, price and
 * **Perform now** (the tooth panel's own action: same toast, same Undo). The footer band carries
 * the plan estimate. Read-only without `visit:write` (W18): no Perform.
 */
export function PlanBoard({ chart, canWrite }: { chart: PatientChart; canWrite: boolean }) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const { notation } = useChartSettings();
  const titleId = useId();
  const groups = planGroups(chart.plans, notation);
  const open = groups.flatMap((group) => group.plans);
  const total = plansTotal(open);
  const teeth = groups.filter((group) => group.tooth !== null).length;

  return (
    <section
      aria-labelledby={titleId}
      className="mb-4 overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center gap-[9px] border-b border-inner-divider px-4 py-3.5">
        <h2 id={titleId} className="m-0 text-[14px] leading-none font-semibold">
          {t('planBoard.title')}
        </h2>
        <span className="text-[12.5px] leading-none text-ink-muted">{t('planBoard.subtitle')}</span>
        {open.length > 0 && (
          <span className="ms-auto text-[12.5px] leading-none text-ink-muted">
            {t('planBoard.countLine', {
              teeth: t('planBoard.teeth', { count: teeth }),
              procedures: t('planBoard.procedures', { count: open.length }),
            })}
          </span>
        )}
      </div>
      {total ? (
        <>
          {groups.map((group) => (
            <PlanGroupRow
              key={group.tooth ?? 'jaw'}
              group={group}
              chart={chart}
              canWrite={canWrite}
            />
          ))}
          <div className="flex items-baseline justify-between gap-3 bg-sunken px-4 py-3">
            <span className="text-[12.5px] leading-none font-semibold">
              {t('planBoard.estimate')}
            </span>
            <span
              dir="ltr"
              className="font-mono text-[17px] leading-none font-bold tracking-[-0.02em] tabular-nums"
            >
              {formatMoney(total, locale)}
            </span>
          </div>
        </>
      ) : (
        <div className="px-[18px] py-6 text-center">
          <h3 className="m-0 mb-[5px] text-[13px] leading-[1.3] font-semibold">
            {t('planBoard.emptyTitle')}
          </h3>
          <p className="m-0 text-[12.5px] leading-normal text-ink-muted">
            {t('planBoard.emptyBody')}
          </p>
        </div>
      )}
    </section>
  );
}

function PlanGroupRow({
  group,
  chart,
  canWrite,
}: {
  group: PlanGroup;
  chart: PatientChart;
  canWrite: boolean;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const actions = useChartingActions();
  const { select } = useToothSelection();
  const toothLabel = useToothLabel();
  const toothName = useToothName();
  const { tooth } = group;
  const diagnoses =
    tooth === null
      ? []
      : chart.diagnoses.filter(
          (record) => record.toothCode === tooth && record.status === 'active',
        );

  return (
    <div
      data-tooth={tooth ?? 'jaw'}
      className="flex flex-wrap items-start gap-3 border-b border-row-divider px-4 py-3"
    >
      <div className="flex-[0_0_128px]">
        {tooth === null ? (
          <span className="font-mono text-[15px] leading-[1.1] font-bold text-primary">
            {t('planBoard.jaw')}
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
        <div className="mt-0.5 text-[12.5px] leading-[1.4] text-ink-tertiary">
          {tooth === null ? t('actions.jawLevel') : toothName(tooth)}
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
      </div>
      <ul className="m-0 flex min-w-0 flex-[1_1_260px] list-none flex-col gap-[7px] p-0">
        {group.plans.map((plan) => {
          const price = formatMoney(plan.price, locale);
          return (
            <li
              key={plan.id}
              className="flex items-center gap-2.5 rounded-[7px] border border-planned-border bg-planned-bg px-[11px] py-[9px]"
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
              {canWrite && (
                <button
                  type="button"
                  title={t('panel.plan.performTitle', { price })}
                  aria-label={t('panel.plan.performNamed', { name: plan.name })}
                  onClick={() => {
                    actions.performPlan(plan);
                  }}
                  className="flex h-7 flex-none cursor-pointer items-center gap-1.5 rounded-md border-0 bg-primary px-[11px] text-[12.5px] leading-none font-semibold text-primary-foreground hover:bg-primary-hover"
                >
                  <span>{t('panel.plan.perform')}</span>
                  <span className="text-primary-tint-border">{t('panel.plan.toToday')}</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
