import type { HistoryService, ToothCode, TreatmentPlan, VisitService } from '@dcm/contracts';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { SaveState } from '@/components/ui/save-state';
import { sanitizeAmountInput } from '@/lib/amount';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { useChartingActions } from '../charting-actions';
import { ServiceMenu } from '../row-menu';
import { UnfinishedRow } from '../unfinished-row';
import { Badge, EmptyBlock, LinkButton, PanelSection } from './panel-section';
import { priceOf, useServicePrice } from './service-price';
import { SurfaceTag } from './surface-tag';

const MICRO =
  'mb-[5px] block text-[11.5px] leading-none font-medium tracking-[.06em] text-ink-tertiary uppercase [&:lang(ar)]:tracking-normal';
const PRICE_INPUT =
  'h-[30px] w-full rounded-md border border-border-strong bg-surface px-2 font-mono text-[12.5px] leading-none font-medium tabular-nums read-only:border-transparent read-only:bg-transparent read-only:px-0 disabled:opacity-60';

/**
 * The Completed stage (spec §Selected Tooth Panel → Body 3): this visit's services on the tooth
 * (or the jaw, or the whole mouth)
 * as cards (name, surface tag, "From plan", the three-dot menu) with Base price and Discount
 * inputs — one autosaved group per service (V6) — and the Final price; before them its unfinished
 * services (ADR-0032), whichever visit started them; then "Previously", the services of earlier
 * visits, with the "Full tooth history →" link. A tooth with none of these shows the empty block.
 */
export function CompletedSection({
  code,
  services,
  unfinished,
  history,
  canWrite,
  canWriteUnfinished,
  open,
  onToggle,
  onAdd,
  onOpenHistory,
}: {
  /** Null for a jaw or the whole mouth: no tooth history to link. */
  code: ToothCode | null;
  services: readonly VisitService[];
  /** The target's plans in progress. */
  unfinished: readonly TreatmentPlan[];
  history: readonly HistoryService[];
  /** Services are charted in a visit only. */
  canWrite: boolean;
  /** An unfinished service is also abandoned from the patient record. */
  canWriteUnfinished: boolean;
  open: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onOpenHistory?: ((code: ToothCode) => void) | undefined;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const parts = [
    ...(unfinished.length > 0 ? [t('unfinished.count', { count: unfinished.length })] : []),
    ...(services.length > 0 ? [t('panel.completed.thisVisit', { count: services.length })] : []),
    ...(history.length > 0 ? [t('panel.completed.previously', { count: history.length })] : []),
  ];
  const summary = parts.length > 0 ? parts.join(' · ') : t('panel.completed.none');

  return (
    <PanelSection
      tone="completed"
      label={t('panel.completed.label')}
      summary={summary}
      open={open}
      onToggle={onToggle}
      add={
        canWrite
          ? { label: t('panel.add'), name: t('panel.completed.add'), onClick: onAdd }
          : undefined
      }
    >
      {unfinished.map((plan) => (
        <UnfinishedRow
          key={plan.id}
          plan={plan}
          canWrite={canWriteUnfinished}
          className="mb-2 rounded-lg border border-warning-border px-3 py-[11px]"
        />
      ))}
      {services.map((service) => (
        <ServiceCard key={service.id} service={service} canWrite={canWrite} />
      ))}
      {history.length > 0 && (
        <div className="border-t border-row-divider pt-[13px] first:border-t-0 first:pt-0">
          <div className="mb-2 text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal">
            {t('panel.completed.previousLabel')}
          </div>
          <table className="w-full border-collapse">
            <tbody>
              {history.map((line) => (
                <tr key={line.id} className="border-b border-row-divider">
                  <td className="py-2 pe-1.5 text-[12.5px] leading-[1.35]">
                    {line.name}
                    <SurfaceTag
                      surfaces={line.surfaces}
                      className="ms-[7px] text-[11.5px] text-ink-muted"
                    />
                  </td>
                  <td className="w-[78px] px-1.5 py-2 font-mono text-[12.5px] leading-[1.35] text-ink-tertiary">
                    {formatCalendarDate(line.visitDate, locale)}
                  </td>
                  <td
                    dir="ltr"
                    className="w-[58px] py-2 ps-1.5 text-end font-mono text-[12.5px] leading-none font-medium tabular-nums"
                  >
                    {formatMoney(line.final, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {onOpenHistory && code !== null && (
            <LinkButton
              className="mt-2.5"
              label={t('panel.completed.fullHistory')}
              onClick={() => {
                onOpenHistory(code);
              }}
            />
          )}
        </div>
      )}
      {services.length === 0 && unfinished.length === 0 && history.length === 0 && (
        <EmptyBlock title={t('panel.completed.emptyTitle')} />
      )}
    </PanelSection>
  );
}

/** One service of this visit, with its autosaved Base price and Discount. */
function ServiceCard({ service, canWrite }: { service: VisitService; canWrite: boolean }) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const actions = useChartingActions();
  const price = useServicePrice(service);
  const baseId = useId();
  const discountId = useId();
  const removing = actions.removing.has(service.id);
  const final = priceOf(price.value).final;

  const field = (key: 'base' | 'discount', id: string, label: string) => (
    <div>
      <label htmlFor={id} className={MICRO}>
        {label}
      </label>
      <input
        id={id}
        dir="ltr"
        inputMode="decimal"
        maxLength={13}
        readOnly={!canWrite}
        disabled={removing}
        value={price.value[key]}
        onChange={(event) => {
          price.setValue({
            ...price.value,
            [key]: sanitizeAmountInput(event.target.value, locale),
          });
        }}
        className={PRICE_INPUT}
      />
    </div>
  );

  return (
    <div
      data-service={service.id}
      className="mb-2 rounded-lg border border-primary-tint-border bg-selected px-3 py-[11px]"
    >
      <div className="mb-[9px] flex items-center gap-2">
        <span className="min-w-0 text-[13px] leading-[1.3] font-semibold">{service.name}</span>
        <SurfaceTag surfaces={service.surfaces} className="text-primary" />
        <span className="flex-1" />
        {service.planId !== null && <Badge tone="warning">{t('panel.completed.fromPlan')}</Badge>}
        {canWrite && <ServiceMenu service={service} />}
      </div>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        {field('base', baseId, t('panel.completed.base'))}
        {field('discount', discountId, t('panel.completed.discount'))}
        <div className="pb-1 text-end">
          <span className={MICRO}>{t('panel.completed.final')}</span>
          <span dir="ltr" className="font-mono text-[15px] leading-none font-bold tabular-nums">
            {formatMoney({ amount: final, currency: service.final.currency }, locale)}
          </span>
        </div>
      </div>
      {price.state !== 'idle' && (
        <div className="mt-2">
          <SaveState status={price.state} onRetry={price.retry} />
        </div>
      )}
    </div>
  );
}
