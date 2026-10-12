import {
  type ChargeUnit,
  isPrimary,
  isToothCode,
  type Jaw,
  PERMANENT_CODES,
  type PlanPriority,
  PRIMARY_CODES,
  quadrant,
  type ServiceItem,
  type ToothCode,
  type TreatmentPlan,
} from '@dcm/contracts';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/field';
import { useLevelLabel, useToothLabel } from '../chart/use-chart-settings';
import { DEFAULT_PLAN_PRIORITY, useChartingActions } from '../workspace/charting-actions';
import { FIELD_LABEL, MICRO } from './flow-styles';
import { PriorityControl } from './priority-control';
import { ProposedPlans } from './proposed-plans';
import { ServicePicker } from './service-picker';

/** Where a treatment goes: a tooth, a jaw, or the whole mouth. */
type Where = ToothCode | Jaw | 'mouth';

const LEVELS = ['upper', 'lower', 'mouth'] as const;
const QUADRANTS = [
  [1, 'upperRight'],
  [2, 'upperLeft'],
  [3, 'lowerLeft'],
  [4, 'lowerRight'],
] as const;

const isLevel = (value: string): value is (typeof LEVELS)[number] =>
  LEVELS.some((level) => level === value);

/** The catalog services that are charged the way this target is: per tooth, per jaw, per mouth. */
const unitOf = (where: Where): ChargeUnit =>
  where === 'mouth'
    ? 'per_mouth'
    : where === 'upper' || where === 'lower'
      ? 'per_jaw'
      : 'per_tooth';

/**
 * The Plan step's **Other treatment** card (feature 10, V7): treatment that answers none of the
 * visit's diagnosis cards — on any other tooth, diagnosed or not, on a jaw or on the whole
 * mouth. Closed, it is one quiet button under the cards, which stay the focus of the step. Open:
 * **Where** (the two jaws and the whole mouth, then the teeth by quadrant; primary teeth too
 * while the patient has any), the priority of the next treatment, and the catalog's services
 * that are charged at that level. What was added this way is listed with where it goes, its
 * priority and Remove. A treatment on a tooth that has an open diagnosis is linked to it by the
 * API, and so shows as that diagnosis's card instead.
 */
export function OtherTreatmentCard({
  plans,
  services,
  withPrimary,
}: {
  /** This visit's open plans that are on no diagnosis card. */
  plans: readonly TreatmentPlan[];
  /** The active catalog services, of every charge unit. */
  services: readonly ServiceItem[];
  /** The patient has primary teeth: they are offered too. */
  withPrimary: boolean;
}) {
  const { t } = useTranslation('clinical');
  const actions = useChartingActions();
  const toothLabel = useToothLabel();
  const levelLabel = useLevelLabel();
  const whereId = useId();
  const [opened, setOpened] = useState(false);
  const [where, setWhere] = useState<Where | null>(null);
  const [priority, setPriority] = useState<PlanPriority>(DEFAULT_PLAN_PRIORITY);

  if (!opened && plans.length === 0) {
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setOpened(true);
          }}
          className="h-9 cursor-pointer rounded-lg border border-dashed border-border-strong bg-surface px-[13px] text-[12.5px] leading-none font-medium text-primary hover:border-primary"
        >
          {t('flow.other.open')}
        </button>
      </div>
    );
  }

  const teeth = [...PERMANENT_CODES, ...(withPrimary ? PRIMARY_CODES : [])];
  const offered =
    where === null ? [] : services.filter((item) => item.chargeUnit === unitOf(where));
  const propose = (item: ServiceItem) => {
    if (where === null) return;
    const target = isToothCode(where)
      ? { tooth: where, surfaces: [] }
      : { tooth: null, surfaces: [], jaw: where === 'mouth' ? undefined : where };
    actions.planTreatment(item, target, { priority });
  };

  return (
    <section
      aria-label={t('flow.other.title')}
      data-other-treatment
      className="grid rounded-xl border border-border bg-surface md:grid-cols-[minmax(200px,250px)_minmax(0,1fr)]"
    >
      <div className="rounded-s-xl border-row-divider bg-sunken px-[18px] py-4 md:border-e">
        <h2 className="m-0 text-[13px] leading-[1.35] font-semibold">{t('flow.other.title')}</h2>
        <p className="m-0 mt-[3px] text-[12px] leading-[1.35] text-ink-muted">
          {t('flow.other.hint')}
        </p>
        <label htmlFor={whereId} className={`${FIELD_LABEL} mt-4`}>
          {t('flow.other.where')}
        </label>
        <Select
          id={whereId}
          value={where ?? ''}
          onChange={(event) => {
            const { value } = event.target;
            setWhere(isToothCode(value) || isLevel(value) ? value : null);
          }}
          className="w-full"
        >
          <option value="">{t('flow.other.choose')}</option>
          <optgroup label={t('flow.other.levels')}>
            {LEVELS.map((level) => (
              <option key={level} value={level}>
                {levelLabel(level === 'mouth' ? null : level)}
              </option>
            ))}
          </optgroup>
          {QUADRANTS.map(([number, key]) => (
            <optgroup key={key} label={t(`quadrant.${key}`)}>
              {teeth
                .filter((code) => quadrant(code) === number)
                .map((code) => (
                  <option key={code} value={code}>
                    {isPrimary(code)
                      ? t('flow.other.primaryTooth', { label: toothLabel(code) })
                      : toothLabel(code)}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>
        <div className={`${MICRO} mt-4 mb-[7px]`}>{t('flow.proposal.priority')}</div>
        <PriorityControl value={priority} label={t('flow.other.priority')} onChange={setPriority} />
      </div>
      <div className="flex min-w-0 flex-col gap-2.5 px-[18px] py-3.5">
        {plans.length > 0 && <ProposedPlans plans={plans} canWrite withTarget />}
        {where === null ? (
          <span className="text-[12.5px] leading-[1.45] text-ink-muted">
            {t('flow.other.chooseFirst')}
          </span>
        ) : offered.length === 0 ? (
          <span className="text-[12.5px] leading-[1.45] text-ink-muted">
            {t('flow.other.noServices')}
          </span>
        ) : (
          <ServicePicker
            // A new target starts a new search.
            key={where}
            services={offered}
            searchLabel={t('flow.other.search')}
            onPick={propose}
          />
        )}
      </div>
    </section>
  );
}
