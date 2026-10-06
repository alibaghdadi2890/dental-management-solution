import {
  isPrimary,
  type Jaw,
  type PatientChart,
  type PlanGroup,
  type ToothCode,
  type ToothNotation,
  toUniversal,
  type TreatmentPlan,
} from '@dcm/contracts';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/ui/confirm-context';
import { openPrintable, printPath } from '@/features/billing/payments-api';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useChartSettings,
  useLevelLabel,
  useToothLabel,
  useToothName,
} from '../chart/use-chart-settings';
import { PlanGroupDialog } from '../record/plan-group-dialog';
import { type PlanGroupActions, useChartingActions } from './charting-actions';
import { PlanDismiss } from './tooth-panel/plan-section';
import { SurfaceTag } from './tooth-panel/surface-tag';
import { plansTotal } from './tooth-panel/tooth-records';
import { useToothSelection } from './tooth-selection';

/** One tooth's open plans, or one level's (a jaw, or the whole mouth when both are null). */
interface PlanGroupOfTarget {
  tooth: ToothCode | null;
  jaw: Jaw | null;
  plans: TreatmentPlan[];
}

/** What a target group is keyed and marked by: the tooth code, the jaw, or `mouth`. */
const targetKey = (group: Pick<PlanGroupOfTarget, 'tooth' | 'jaw'>) =>
  group.tooth ?? group.jaw ?? 'mouth';

/** A tooth's place in the clinic's numbering: permanent teeth first, then primary; FDI by its
 * number, Universal by its number (1–32) or letter (A–T), as the POC orders its board. */
function numberingRank(code: ToothCode, notation: ToothNotation): [number, number] {
  const kind = isPrimary(code) ? 1 : 0;
  if (notation === 'fdi') return [kind, Number(code)];
  const universal = toUniversal(code);
  return [kind, isPrimary(code) ? universal.charCodeAt(0) : Number(universal)];
}

/** Plans grouped by tooth in numbering order, then the upper jaw, the lower jaw and the whole
 * mouth. */
function byTarget(plans: readonly TreatmentPlan[], notation: ToothNotation): PlanGroupOfTarget[] {
  const groups = new Map<string, PlanGroupOfTarget>();
  for (const plan of plans) {
    const key = targetKey({ tooth: plan.toothCode, jaw: plan.jaw });
    const group = groups.get(key) ?? { tooth: plan.toothCode, jaw: plan.jaw, plans: [] };
    group.plans.push(plan);
    groups.set(key, group);
  }
  const rank = ({ tooth, jaw }: PlanGroupOfTarget): [number, number] =>
    tooth === null
      ? [2, jaw === 'upper' ? 0 : jaw === 'lower' ? 1 : 2]
      : numberingRank(tooth, notation);
  return [...groups.values()].sort((a, b) => {
    const [kindA, numberA] = rank(a);
    const [kindB, numberB] = rank(b);
    return kindA - kindB || numberA - numberB;
  });
}

/**
 * The Treatment plan card (spec §Visit Workspace → Body 2): the patient's planned procedures,
 * whichever visit recorded them, grouped by tooth (the jaws and the whole mouth last). Work that
 * was started and not finished is a service, not a plan (ADR-0032): it is not listed here. Each group's 128px
 * column holds the tooth label — a link that selects the tooth — its anatomical name and its
 * active diagnoses (`danger`, or "No diagnosis recorded"; a jaw or whole-mouth group shows only
 * its level); beside it the plan rows with name, surfaces and price. The footer band carries the
 * plan estimate.
 *
 * When the patient has named plans (levels spec P7), each is a section with its title, note and
 * own estimate, followed by the plans in none. In a visit a planned row offers **Perform now** (the
 * tooth panel's own action: same toast, same Undo). On the patient record (`groups` given) a row
 * instead offers its named plan and **Remove** or **Cancel**, and the card **New plan**, with
 * **Rename** and **Delete** per named plan. Read-only without the scope's write permission.
 */
export function PlanBoard({
  chart,
  canWrite,
  groups,
}: {
  chart: PatientChart;
  canWrite: boolean;
  /** Named-plan management: the patient record's Chart tab only. */
  groups?: PlanGroupActions | undefined;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const { notation } = useChartSettings();
  const confirm = useConfirm();
  const titleId = useId();
  const [editing, setEditing] = useState<PlanGroup | 'new' | null>(null);
  const open = chart.plans.filter((plan) => plan.status === 'planned');
  const total = plansTotal(open);
  const teeth = new Set(open.flatMap((plan) => plan.toothCode ?? [])).size;
  const named = new Set(chart.planGroups.map((group) => group.id));
  const loose = open.filter((plan) => plan.groupId === null || !named.has(plan.groupId));
  const manage = canWrite && groups ? groups : undefined;
  const [patientId] = [open[0]?.patientId];

  const rows = (plans: readonly TreatmentPlan[]) =>
    byTarget(plans, notation).map((group) => (
      <TargetRow
        key={targetKey(group)}
        group={group}
        chart={chart}
        canWrite={canWrite}
        groups={manage}
      />
    ));

  return (
    <section
      aria-labelledby={titleId}
      className="mb-4 overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center gap-[9px] border-b border-inner-divider px-4 py-3.5">
        <h2 id={titleId} className="m-0 text-[14px] leading-none font-semibold">
          {t('planBoard.title')}
        </h2>
        <span className="ms-auto flex items-center gap-3">
          {open.length > 0 && (
            <span className="text-[12.5px] leading-none text-ink-muted">
              {t('planBoard.countLine', {
                teeth: t('planBoard.teeth', { count: teeth }),
                procedures: t('planBoard.procedures', { count: open.length }),
              })}
            </span>
          )}
          {manage && (
            <button
              type="button"
              onClick={() => {
                setEditing('new');
              }}
              className="h-7 cursor-pointer rounded-md border border-border-control bg-surface px-[11px] text-[12.5px] leading-none font-medium hover:border-border-strong"
            >
              {t('planBoard.newPlan')}
            </button>
          )}
        </span>
      </div>
      {chart.planGroups.map((group) => {
        const plans = open.filter((plan) => plan.groupId === group.id);
        const estimate = plansTotal(plans);
        return (
          <div key={group.id} data-plan-group={group.id}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-row-divider bg-faint px-4 py-2.5">
              <h3 className="m-0 text-[13px] leading-[1.3] font-semibold">{group.title}</h3>
              {group.note && (
                <span className="min-w-0 text-[12.5px] leading-[1.4] text-ink-muted">
                  {group.note}
                </span>
              )}
              <span className="ms-auto flex items-baseline gap-3">
                {manage && (
                  <>
                    <button
                      type="button"
                      aria-label={t('planBoard.renameNamed', { title: group.title })}
                      onClick={() => {
                        setEditing(group);
                      }}
                      className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] leading-none font-medium text-primary hover:underline"
                    >
                      {t('planBoard.rename')}
                    </button>
                    <button
                      type="button"
                      aria-label={t('planBoard.deleteNamed', { title: group.title })}
                      onClick={() => {
                        confirm({
                          title: t('planBoard.deleteTitle', { title: group.title }),
                          body: t('planBoard.deleteBody'),
                          okLabel: t('planBoard.deleteOk'),
                          tone: 'warn',
                          onConfirm: () => {
                            manage.remove(group.id);
                          },
                        });
                      }}
                      className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] leading-none font-medium text-danger hover:underline"
                    >
                      {t('planBoard.delete')}
                    </button>
                  </>
                )}
                {estimate && (
                  <span
                    dir="ltr"
                    className="font-mono text-[13px] leading-none font-semibold tabular-nums"
                  >
                    {formatMoney(estimate, locale)}
                  </span>
                )}
              </span>
            </div>
            {plans.length > 0 ? (
              rows(plans)
            ) : (
              <p className="m-0 border-b border-row-divider px-4 py-3 text-[12.5px] leading-normal text-ink-muted">
                {t('planBoard.emptyGroup')}
              </p>
            )}
          </div>
        );
      })}
      {chart.planGroups.length > 0 && loose.length > 0 && (
        <h3 className="m-0 border-b border-row-divider bg-faint px-4 py-2.5 text-[13px] leading-[1.3] font-semibold">
          {t('planBoard.other')}
        </h3>
      )}
      {rows(loose)}
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
        chart.planGroups.length === 0 && (
          <div className="px-[18px] py-6 text-center">
            <h3 className="m-0 text-[13px] leading-[1.3] font-semibold">
              {t('planBoard.emptyTitle')}
            </h3>
          </div>
        )
      )}
      {manage && editing !== null && (
        <PlanGroupDialog
          group={editing === 'new' ? undefined : editing}
          onSave={(input) =>
            editing === 'new' ? manage.create(input) : manage.update(editing.id, input)
          }
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function TargetRow({
  group,
  chart,
  canWrite,
  groups,
}: {
  group: PlanGroupOfTarget;
  chart: PatientChart;
  canWrite: boolean;
  groups: PlanGroupActions | undefined;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const actions = useChartingActions();
  const { select } = useToothSelection();
  const toothLabel = useToothLabel();
  const toothName = useToothName();
  const levelLabel = useLevelLabel();
  const { tooth } = group;
  const inVisit = actions.scope.kind === 'visit';
  const diagnoses =
    tooth === null
      ? []
      : chart.diagnoses.filter(
          (record) => record.toothCode === tooth && record.status === 'active',
        );

  return (
    <div
      data-tooth={targetKey(group)}
      className="flex flex-wrap items-start gap-3 border-b border-row-divider px-4 py-3"
    >
      <div className="flex-[0_0_128px]">
        {tooth === null ? (
          <span className="text-[14px] leading-[1.2] font-bold text-primary">
            {levelLabel(group.jaw)}
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
        {group.plans.map((plan) => {
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
              {groups && chart.planGroups.length > 0 && (
                <select
                  aria-label={t('planBoard.moveTo', { name: plan.name })}
                  value={plan.groupId ?? ''}
                  onChange={(event) => {
                    groups.movePlan(plan.id, event.target.value || null);
                  }}
                  className="h-7 max-w-[160px] flex-none cursor-pointer rounded-md border border-border-control bg-surface px-1.5 text-[12.5px] leading-none"
                >
                  <option value="">{t('planBoard.noGroup')}</option>
                  {chart.planGroups.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.title}
                    </option>
                  ))}
                </select>
              )}
              {canWrite && !inVisit && <PlanDismiss plan={plan} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
