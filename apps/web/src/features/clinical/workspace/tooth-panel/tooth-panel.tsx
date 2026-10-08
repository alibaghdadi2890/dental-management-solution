import {
  isPrimary,
  isUpper,
  type PatientChart,
  type ToothCode,
  type ToothState,
  type Visit,
} from '@dcm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ToothImageCount, ToothImages } from '@/features/files/file-rows';
import { formatMoney } from '@/lib/format';
import { PanelGlyph } from '../../chart/panel-glyph';
import { PresenceMenu } from '../../presence/presence-menu';
import { latestPresence, presenceBanner } from '../../presence/presence-text';
import {
  useChartSettings,
  useSurfaceLabel,
  useToothLabel,
  useToothName,
} from '../../chart/use-chart-settings';
import type { DrawerMode } from '../charting-actions';
import { useToothSelection } from '../tooth-selection';
import { AreaPanel } from './area-panel';
import { CompletedSection } from './completed-section';
import { DiagnosisSection } from './diagnosis-section';
import { Badge } from './panel-section';
import { PlanSection } from './plan-section';
import { QuickAdd } from './quick-add';
import { plansTotal, toothRecords } from './tooth-records';

type SectionKey = 'diagnosis' | 'plan' | 'completed';

/** The ghost glyph's cells (row-major): the five surfaces of a tooth, corners blank. */
const GHOST = [false, true, false, true, true, true, false, true, false];

export interface ToothPanelProps {
  /** Whose chart this is: the tooth's images are the patient's (feature 8). */
  patientId: string;
  /** The live visit; null on the patient record, where only diagnoses and plans are charted. */
  visit: Visit | null;
  chart: PatientChart;
  /** `deriveChart` over the chart and this visit's services (the chart card's own map). */
  teeth: ReadonlyMap<ToothCode, ToothState>;
  canWrite: boolean;
  timeZone: string;
  onOpenDrawer: (mode: DrawerMode) => void;
  /** Opens the tooth-history dialog ("Full tooth history →"); the link is left out without it. */
  onOpenHistory?: ((code: ToothCode) => void) | undefined;
}

/**
 * The selected-tooth panel (spec §Selected Tooth Panel): with a jaw or the whole mouth selected,
 * `AreaPanel`; with nothing, the empty state; else a
 * header (the enlarged glyph — its surfaces scope the next record in surface mode — the label,
 * Upper/Lower, the Presence control and its one-line banner (feature 7: a missing, not-erupted
 * or implant position is charted like any other), the name and the pending surfaces), in a visit
 * the quick add (`QuickAdd`), the planned strip, then the three
 * stages, each collapsible and open by default, and under them the tooth's **Images** (feature
 * 8; their count is in the header). Read-only without `visit:write` (W18): no add,
 * remove or perform controls and no surface toggles.
 */
export function ToothPanel(props: ToothPanelProps) {
  const { tooth, area } = useToothSelection();
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
        area === null ? (
          <EmptyPanel />
        ) : (
          <AreaPanel {...props} area={area} sections={sections} />
        )
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
      <h3 className="m-0 text-[14px] leading-[1.3] font-semibold">{t('panel.emptyTitle')}</h3>
    </div>
  );
}

function SelectedTooth({
  patientId,
  visit,
  chart,
  teeth,
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
  // What the chart knows is at this position, and the row that says so (feature 7, H1).
  const presence = teeth.get(code)?.presence ?? 'present';
  const presenceRow = latestPresence(chart, code);
  const openTotal = plansTotal(openPlans);
  // Services are charted in a visit only.
  const canChartVisit = canWrite && visit !== null;

  // The pending surface scope, while there is one.
  const hint =
    mode === 'surface' && selection.surfaces.length > 0
      ? t('panel.hintSelected', {
          surfaces: selection.surfaces.map(surfaceLabel.name).join(t('title.listSeparator')),
        })
      : null;

  return (
    <>
      <div className="flex items-start gap-3.5 border-b border-inner-divider bg-sunken px-4 py-[15px]">
        <PanelGlyph
          code={code}
          tooth={teeth.get(code)}
          presence={presence}
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
            <ToothImageCount patientId={patientId} code={code} />
            {canWrite ? (
              <PresenceMenu code={code} presence={presence} />
            ) : (
              presence !== 'present' && (
                <Badge tone="neutral">{t(`presence.states.${presence}`)}</Badge>
              )
            )}
          </div>
          <div className="mb-[7px] text-[12.5px] leading-[1.45] text-ink-tertiary">
            {name(code)}
          </div>
          {presence !== 'present' && presenceRow && (
            <p
              data-presence-banner
              className="m-0 mb-[7px] text-[12.5px] leading-[1.4] text-ink-muted"
            >
              {presenceBanner(t, presenceRow, locale)}
            </p>
          )}
          {hint && (
            <p role="status" className="m-0 text-[12.5px] leading-[1.4] text-ink-muted">
              {hint}
            </p>
          )}
        </div>
      </div>
      {canChartVisit && (
        <QuickAdd
          onOpen={() => {
            onOpenDrawer('service');
          }}
        />
      )}
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
          unfinished={records.plans.filter((plan) => plan.status === 'in_progress')}
          history={records.history}
          canWrite={canChartVisit}
          canWriteUnfinished={canWrite}
          open={sections.isOpen('completed')}
          onToggle={sections.toggle('completed')}
          onAdd={() => {
            onOpenDrawer('service');
          }}
          onOpenHistory={onOpenHistory}
        />
        <ToothImages patientId={patientId} code={code} visit={visit} />
      </div>
    </>
  );
}
