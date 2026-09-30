import {
  type DentitionStage,
  isPrimary,
  isUpper,
  type PatientChart,
  type ToothCode,
  type ToothState,
  type Visit,
} from '@dcm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@/lib/format';
import { PanelGlyph } from '../../chart/panel-glyph';
import {
  useChartSettings,
  useSurfaceLabel,
  useToothLabel,
  useToothName,
} from '../../chart/use-chart-settings';
import type { DrawerMode } from '../charting-actions';
import { useToothSelection } from '../tooth-selection';
import { CompletedSection } from './completed-section';
import { DiagnosisSection } from './diagnosis-section';
import { Badge } from './panel-section';
import { PlanSection } from './plan-section';
import { SuccessionRow } from './succession-row';
import { plansTotal, toothRecords } from './tooth-records';

type SectionKey = 'diagnosis' | 'plan' | 'completed';

/** The ghost glyph's cells (row-major): the five surfaces of a tooth, corners blank. */
const GHOST = [false, true, false, true, true, true, false, true, false];

export interface ToothPanelProps {
  visit: Visit;
  chart: PatientChart;
  /** `deriveChart` over the chart and this visit's services (the chart card's own map). */
  teeth: ReadonlyMap<ToothCode, ToothState>;
  dentition: DentitionStage;
  canWrite: boolean;
  timeZone: string;
  onOpenDrawer: (mode: DrawerMode) => void;
  /** Opens the tooth-history dialog ("Full tooth history →"); the link is left out without it. */
  onOpenHistory?: ((code: ToothCode) => void) | undefined;
}

/**
 * The selected-tooth panel (spec §Selected Tooth Panel): with no tooth, the empty state; else a
 * header (the enlarged glyph — its surfaces scope the next record in surface mode — the label,
 * Upper/Lower, the name, the succession row and a live hint), the planned strip, then the three
 * stages, each collapsible and open by default. Read-only without `visit:write` (W18): no add,
 * remove or perform controls and no surface toggles.
 */
export function ToothPanel(props: ToothPanelProps) {
  const { tooth } = useToothSelection();
  // The open state belongs to the panel, not the tooth: it survives a change of selection.
  const [closed, setClosed] = useState<ReadonlySet<SectionKey>>(() => new Set());
  const toggle = (key: SectionKey) => () => {
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };
  const sections = {
    isOpen: (key: SectionKey) => !closed.has(key),
    toggle,
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {tooth === null ? (
        <EmptyPanel />
      ) : (
        <SelectedTooth {...props} code={tooth} sections={sections} />
      )}
    </div>
  );
}

function EmptyPanel() {
  const { t } = useTranslation('clinical');
  return (
    <div className="px-[22px] py-[46px] text-center">
      <div
        aria-hidden
        className="mx-auto mb-[13px] grid size-[38px] grid-cols-[repeat(3,11px)] grid-rows-[repeat(3,11px)] justify-center gap-px opacity-50"
      >
        {GHOST.map((filled, index) => (
          <span
            key={index}
            className={filled ? 'rounded-[1.5px] border border-border-control bg-subtle' : ''}
          />
        ))}
      </div>
      <h3 className="m-0 mb-[5px] text-[14px] leading-[1.3] font-semibold">
        {t('panel.emptyTitle')}
      </h3>
      <p className="m-0 text-[12.5px] leading-[1.55] text-ink-muted">{t('panel.emptyBody')}</p>
    </div>
  );
}

function SelectedTooth({
  visit,
  chart,
  teeth,
  dentition,
  canWrite,
  timeZone,
  onOpenDrawer,
  onOpenHistory,
  code,
  sections,
}: ToothPanelProps & {
  code: ToothCode;
  sections: { isOpen: (key: SectionKey) => boolean; toggle: (key: SectionKey) => () => void };
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const { mode, orientation } = useChartSettings();
  const selection = useToothSelection();
  const label = useToothLabel();
  const name = useToothName();
  const surfaceLabel = useSurfaceLabel();
  const records = toothRecords(code, chart, visit);
  const openPlans = records.plans.filter((plan) => plan.status === 'planned');
  const openTotal = plansTotal(openPlans);

  const hint =
    mode === 'simple'
      ? t('panel.hintSimple')
      : selection.surfaces.length > 0
        ? t('panel.hintSelected', {
            surfaces: selection.surfaces.map(surfaceLabel.name).join(t('title.listSeparator')),
          })
        : canWrite
          ? t('panel.hintSurface')
          : null;

  return (
    <>
      <div className="flex items-start gap-3.5 border-b border-inner-divider bg-sunken px-4 py-[15px]">
        <PanelGlyph
          code={code}
          tooth={teeth.get(code)}
          mode={mode}
          orientation={orientation}
          pendingSurfaces={selection.surfaces}
          {...(canWrite && { onSurfaceClick: selection.toggleSurface })}
        />
        <div className="min-w-0 flex-1">
          <div className="mb-[3px] flex flex-wrap items-baseline gap-2">
            <h2
              dir="ltr"
              className="m-0 font-mono text-[22px] leading-none font-bold tracking-[-0.02em]"
            >
              {label(code)}
            </h2>
            <span className="text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal">
              {t(isUpper(code) ? 'panel.upper' : 'panel.lower')}
            </span>
            {isPrimary(code) && <Badge tone="neutral">{t('panel.primary')}</Badge>}
          </div>
          <div className="mb-[7px] text-[12.5px] leading-[1.45] text-ink-tertiary">
            {name(code)}
          </div>
          <SuccessionRow
            code={code}
            chart={chart}
            visit={visit}
            dentition={dentition}
            canWrite={canWrite}
            onSelect={selection.select}
          />
          {hint && (
            <p role="status" className="m-0 text-[12.5px] leading-[1.4] text-ink-muted">
              {hint}
            </p>
          )}
        </div>
      </div>
      {openTotal && (
        <div className="border-b border-planned-strip-border bg-planned-strip px-4 py-[9px] text-[11.5px] leading-[1.4] font-medium text-warning">
          {t('panel.plannedStrip', {
            names: openPlans.map((plan) => plan.name).join(t('title.listSeparator')),
            total: formatMoney(openTotal, locale),
          })}
        </div>
      )}
      <div className="px-4 py-[15px]">
        <DiagnosisSection
          diagnoses={records.diagnoses}
          visitId={visit.id}
          canWrite={canWrite}
          open={sections.isOpen('diagnosis')}
          onToggle={sections.toggle('diagnosis')}
          onAdd={() => {
            onOpenDrawer('diagnosis');
          }}
        />
        <PlanSection
          plans={records.plans}
          diagnoses={chart.diagnoses}
          visitId={visit.id}
          timeZone={timeZone}
          canWrite={canWrite}
          open={sections.isOpen('plan')}
          onToggle={sections.toggle('plan')}
          onAdd={() => {
            onOpenDrawer('plan');
          }}
        />
        <CompletedSection
          code={code}
          services={records.services}
          history={records.history}
          canWrite={canWrite}
          open={sections.isOpen('completed')}
          onToggle={sections.toggle('completed')}
          onAdd={() => {
            onOpenDrawer('service');
          }}
          onOpenHistory={onOpenHistory}
        />
      </div>
    </>
  );
}
