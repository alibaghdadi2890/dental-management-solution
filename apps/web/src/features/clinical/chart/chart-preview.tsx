import {
  type ChartMode,
  type ChartOrientation,
  type ToothCode,
  type ToothNotation,
  type ToothState,
  toothLabel,
} from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { ToothGlyph } from './tooth-glyph';

/**
 * Live previews for the Settings → Dental / tooth chart cards (spec §Settings; POC
 * `buildTeethPreview` / `orientationCards`). Presentational only — fixed example teeth, not the
 * clinic's real chart — so a card shows what picking it means before it is picked.
 */

/** Four columns the Chart detail cards preview, one lightly "treated" so surface vs. whole-tooth
 * detail is visible at a glance. */
const DETAIL_PREVIEW_CODES: readonly ToothCode[] = ['16', '15', '14', '13'];
const DETAIL_FILLED_INDEX = 1;

/** The brief's own example (`#11 #16 #55` vs `#8 #3 A`): an anterior and a posterior permanent
 * tooth plus a primary one, so both the numbering shift and the letter case show. */
const NOTATION_PREVIEW_CODES: readonly ToothCode[] = ['11', '16', '55'];

function previewTooth(code: ToothCode): ToothState {
  return {
    code,
    presence: 'present',
    state: 'treated',
    surfaces: { O: 'treated', B: 'treated' },
    wholeTooth: null,
    hasActiveDiagnosis: false,
    openPlanIds: [],
    historyCount: 1,
    titleParts: { diagnoses: [], plans: [], historyCount: 1 },
  };
}

/** The Chart detail cards' preview: four 9 px teeth rendered in the mode the card offers. */
export function ChartDetailPreview({
  mode,
  orientation,
}: {
  mode: ChartMode;
  orientation: ChartOrientation;
}) {
  return (
    <span aria-hidden dir="ltr" className="flex flex-none items-end gap-1">
      {DETAIL_PREVIEW_CODES.map((code, index) => (
        <ToothGlyph
          key={code}
          variant="chart"
          code={code}
          tooth={index === DETAIL_FILLED_INDEX ? previewTooth(code) : undefined}
          mode={mode}
          orientation={orientation}
          size={9}
        />
      ))}
    </span>
  );
}

/** The Notation cards' preview: the same three teeth's labels in that notation. */
export function NotationPreview({ notation }: { notation: ToothNotation }) {
  return (
    <span
      dir="ltr"
      className="flex flex-none items-center gap-2 font-mono text-[12.5px] text-ink-muted"
    >
      {NOTATION_PREVIEW_CODES.map((code) => (
        <span key={code}>{toothLabel(code, notation)}</span>
      ))}
    </span>
  );
}

/** POC `orientationCards`' own static rows — illustrative, not derived from real tooth codes. */
const ORIENTATION_PREVIEW_NUMS: Record<ChartOrientation, readonly string[]> = {
  patient_right_on_right: ['16', '15', '14', '…', '3', '2', '1'],
  patient_right_on_left: ['1', '2', '3', '…', '14', '15', '16'],
};

/** The Orientation cards' preview: a numbered row with R/L markers on each side, flipped with
 * the setting (W3). */
export function OrientationPreview({ orientation }: { orientation: ChartOrientation }) {
  const { t } = useTranslation('clinical');
  const nums = ORIENTATION_PREVIEW_NUMS[orientation];
  const [start, end] =
    orientation === 'patient_right_on_right'
      ? [t('chart.left'), t('chart.right')]
      : [t('chart.right'), t('chart.left')];
  return (
    <span
      aria-hidden
      data-orientation-preview
      dir="ltr"
      className="flex flex-none items-center gap-[7px]"
    >
      <span data-mark="start" className="font-mono text-[12.5px] tracking-[.1em] text-ink-muted">
        {start}
      </span>
      <span className="flex gap-[3px]">
        {nums.map((value, index) => (
          <span
            key={index}
            className="grid size-[22px] place-items-center rounded border border-border-control bg-surface font-mono text-[12.5px] text-ink-muted"
          >
            {value}
          </span>
        ))}
      </span>
      <span data-mark="end" className="font-mono text-[12.5px] tracking-[.1em] text-ink-muted">
        {end}
      </span>
    </span>
  );
}
