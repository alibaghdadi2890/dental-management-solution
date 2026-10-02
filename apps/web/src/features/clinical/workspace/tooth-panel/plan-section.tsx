import type { DiagnosisRecord, TreatmentPlan } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/ui/confirm-context';
import { useToast } from '@/components/ui/toast-context';
import { formatDate, formatMoney } from '@/lib/format';
import { useChartingActions } from '../charting-actions';
import { Badge, EmptyBlock, LinkButton, PanelSection } from './panel-section';
import { SurfaceTag } from './surface-tag';
import { plansTotal } from './tooth-records';

/**
 * The Treatment plan stage (spec §Selected Tooth Panel → Body 2): per open plan the name, surface
 * tag and price, a Planned badge, "for `<diagnosis>`" when linked, the date, **Perform now**,
 * and **Remove** for a plan recorded in this visit or **Cancel** for an older one (W13). A plan
 * performed in this visit is shown by its completed service below, so it leaves only the
 * one-line "performed — see below" note.
 */
export function PlanSection({
  plans,
  diagnoses,
  visitId,
  timeZone,
  canWrite,
  open,
  onToggle,
  onAdd,
}: {
  /** This tooth's plans, whatever their status. */
  plans: readonly TreatmentPlan[];
  /** The patient's diagnoses, to name the one a plan is for. */
  diagnoses: readonly DiagnosisRecord[];
  visitId: string;
  timeZone: string;
  canWrite: boolean;
  open: boolean;
  onToggle: () => void;
  onAdd: () => void;
}) {
  const { t, i18n } = useTranslation('clinical');
  const confirm = useConfirm();
  const toast = useToast();
  const locale = i18n.resolvedLanguage ?? 'en';
  const actions = useChartingActions();
  const openPlans = plans.filter((plan) => plan.status === 'planned');
  const performedHere = plans.filter(
    (plan) => plan.status === 'performed' && plan.performedInVisitId === visitId,
  );
  const total = plansTotal(openPlans);
  // Collapsed, it says what the open body shows: "all performed" goes with the note (plans
  // performed in this visit); a plan performed earlier lives under Previously, so it reads as
  // nothing planned, like the empty block.
  const summary = total
    ? t('panel.plan.summary', {
        names: openPlans.map((plan) => plan.name).join(t('title.listSeparator')),
        total: formatMoney(total, locale),
      })
    : performedHere.length > 0
      ? t('panel.plan.allPerformed')
      : t('panel.plan.none');

  return (
    <PanelSection
      tone="plan"
      label={t('panel.plan.label')}
      summary={summary}
      open={open}
      onToggle={onToggle}
      add={
        canWrite ? { label: t('panel.add'), name: t('panel.plan.add'), onClick: onAdd } : undefined
      }
    >
      {openPlans.map((plan) => {
        const price = formatMoney(plan.price, locale);
        const diagnosis = diagnoses.find((record) => record.id === plan.diagnosisRecordId);
        return (
          <div
            key={plan.id}
            data-plan={plan.id}
            className="mb-[7px] rounded-lg border border-planned-border bg-planned-bg px-3 py-[11px]"
          >
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="min-w-0 flex-1 text-[13px] leading-[1.35] font-semibold">
                {plan.name}
              </span>
              <SurfaceTag surfaces={plan.surfaces} className="text-warning" />
              <span
                dir="ltr"
                className="font-mono text-[13px] leading-none font-semibold tabular-nums"
              >
                {price}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-[9px]">
              <Badge tone="warning">{t('panel.plan.planned')}</Badge>
              {diagnosis && (
                <span className="text-[12.5px] leading-[1.4] text-ink-muted">
                  {t('panel.plan.for', { name: diagnosis.name })}
                </span>
              )}
              <span className="font-mono text-[12.5px] leading-[1.4] text-ink-muted">
                {formatDate(plan.recordedAt, { timeZone, locale })}
              </span>
              {canWrite && (
                <button
                  type="button"
                  title={t('panel.plan.performTitle', { price })}
                  aria-label={t('panel.plan.performNamed', { name: plan.name })}
                  onClick={() => {
                    actions.performPlan(plan);
                  }}
                  className="ms-auto flex h-7 flex-none cursor-pointer items-center gap-1.5 rounded-md border-0 bg-primary px-[11px] text-[12.5px] leading-none font-semibold text-primary-foreground hover:bg-primary-hover"
                >
                  <span>{t('panel.plan.perform')}</span>
                  <span className="text-primary-tint-border">{t('panel.plan.toToday')}</span>
                </button>
              )}
              {canWrite &&
                (plan.recordedInVisitId === visitId ? (
                  <LinkButton
                    tone="danger"
                    label={t('panel.remove')}
                    name={t('panel.removeNamed', { name: plan.name })}
                    onClick={() => {
                      actions.removePlan(plan.id);
                    }}
                  />
                ) : (
                  <LinkButton
                    tone="danger"
                    label={t('panel.plan.cancel')}
                    name={t('panel.plan.cancelNamed', { name: plan.name })}
                    onClick={() => {
                      // A plan from an earlier visit: confirm first (4a follow-up), then say so.
                      confirm({
                        title: t('panel.plan.cancelTitle', { name: plan.name }),
                        body: t('panel.plan.cancelBody'),
                        okLabel: t('panel.plan.cancelOk'),
                        cancelLabel: t('panel.plan.keep'),
                        tone: 'warn',
                        onConfirm: () => {
                          actions.cancelPlan(plan.id);
                          toast(t('panel.plan.cancelled', { name: plan.name }), {
                            tone: 'success',
                          });
                        },
                      });
                    }}
                  />
                ))}
            </div>
          </div>
        );
      })}
      {performedHere.length > 0 && (
        <div className="flex items-center gap-[7px] rounded-lg border border-inner-divider bg-faint px-3 py-[9px]">
          <span aria-hidden className="size-1.5 flex-none rounded-full bg-success" />
          <span className="text-[12.5px] leading-[1.4] text-ink-secondary">
            {t('panel.plan.performedNote', { count: performedHere.length })}
          </span>
        </div>
      )}
      {openPlans.length === 0 && performedHere.length === 0 && (
        <EmptyBlock
          title={t('panel.plan.emptyTitle')}
          body={canWrite ? t('panel.plan.emptyBody') : undefined}
          action={canWrite ? { label: t('panel.plan.addCta'), onClick: onAdd } : undefined}
        />
      )}
    </PanelSection>
  );
}
