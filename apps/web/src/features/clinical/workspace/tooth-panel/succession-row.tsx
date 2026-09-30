import {
  type DentitionStage,
  isPrimary,
  type PatientChart,
  positionKey,
  predecessorOf,
  presentTooth,
  successorOf,
  type ToothCode,
  type Visit,
} from '@dcm/contracts';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useToothLabel } from '../../chart/use-chart-settings';
import { useChartingActions } from '../charting-actions';
import { toothRecords } from './tooth-records';

const ACTION =
  'ms-auto h-[26px] flex-none cursor-pointer rounded-md border border-border-control bg-surface px-2.5 text-[12.5px] leading-none font-medium hover:border-border-strong';

/**
 * The succession line (spec W5): a primary tooth names its permanent successor, a permanent
 * incisor, canine or premolar its primary predecessor, each a link that selects it. **Mark
 * exfoliated** (on the primary tooth in the chart) and **Still present** (on the permanent tooth
 * in the chart, outside a permanent dentition) record which of the two occupies the position
 * (`PUT /visits/:id/teeth/:position`). Shown for a primary tooth, and for a permanent one in a
 * primary or mixed dentition, or when its predecessor has records.
 */
export function SuccessionRow({
  code,
  chart,
  visit,
  dentition,
  canWrite,
  onSelect,
}: {
  code: ToothCode;
  chart: PatientChart;
  visit: Visit;
  dentition: DentitionStage;
  canWrite: boolean;
  onSelect: (code: ToothCode) => void;
}) {
  const { t } = useTranslation('clinical');
  const label = useToothLabel();
  const actions = useChartingActions();
  const column = positionKey(code);
  const presence = chart.toothStatus.find((record) => record.position === column)?.present;
  // Whether this tooth is the one its column shows (`positionKey` is always a permanent code;
  // the guard only narrows its type): only that one can be swapped for the other.
  const inChart =
    canWrite && !isPrimary(column) && presentTooth(column, dentition, presence).code === code;

  const link = (target: ToothCode) => (
    <button
      type="button"
      dir="ltr"
      onClick={() => {
        onSelect(target);
      }}
      className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[12.5px] leading-none font-semibold text-primary hover:underline"
    >
      {label(target)}
    </button>
  );

  if (isPrimary(code)) {
    const successor = successorOf(code);
    const records = toothRecords(successor, chart, visit);
    const hasRecords =
      records.diagnoses.length +
        records.plans.length +
        records.history.length +
        records.services.length >
      0;
    return (
      <Row>
        <span>{t('succession.successor')}</span>
        {link(successor)}
        <span className="text-ink-muted">
          {t(hasRecords ? 'succession.hasRecords' : 'succession.notErupted')}
        </span>
        {inChart && (
          <button
            type="button"
            className={ACTION}
            onClick={() => {
              actions.setToothPresence(successor, 'permanent', successor);
            }}
          >
            {t('succession.markExfoliated')}
          </button>
        )}
      </Row>
    );
  }

  const predecessor = predecessorOf(code);
  if (predecessor === null) return null;
  const records = toothRecords(predecessor, chart, visit);
  const services = records.history.length + records.services.length;
  const planned = records.plans.filter((plan) => plan.status === 'planned').length;
  if (dentition === 'permanent' && services + records.diagnoses.length + planned === 0) {
    return null;
  }
  const bits = [
    ...(services > 0 ? [t('succession.services', { count: services })] : []),
    ...(records.diagnoses.length > 0
      ? [t('succession.diagnoses', { count: records.diagnoses.length })]
      : []),
    ...(planned > 0 ? [t('succession.planned', { count: planned })] : []),
  ];
  return (
    <Row>
      <span>{t('succession.predecessor')}</span>
      {link(predecessor)}
      <span className="text-ink-muted">
        {bits.length > 0
          ? t('succession.counts', { counts: bits.join(t('title.listSeparator')) })
          : t('succession.noRecords')}
      </span>
      {inChart && dentition !== 'permanent' && (
        <button
          type="button"
          className={ACTION}
          onClick={() => {
            actions.setToothPresence(code, 'primary', predecessor);
          }}
        >
          {t('succession.stillPresent')}
        </button>
      )}
    </Row>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-[7px] border border-inner-divider bg-faint px-[9px] py-[7px] text-[12.5px] leading-[1.4] text-ink-secondary">
      {children}
    </div>
  );
}
