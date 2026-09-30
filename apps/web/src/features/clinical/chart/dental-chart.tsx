import {
  archColumns,
  type DentitionStage,
  isPrimary,
  type PermanentToothCode,
  presentTooth,
  type ToothCode,
  type ToothPresence,
  type ToothState,
  toothLabel,
} from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { chartGlyphBox } from './glyph-style';
import { ToothGlyph } from './tooth-glyph';
import { toothTitle } from './tooth-title';
import { useChartSettings, useToothName } from './use-chart-settings';

export interface DentalChartProps {
  /** `deriveChart`'s sparse map: a tooth absent from it has no recorded treatment. */
  teeth: ReadonlyMap<ToothCode, ToothState>;
  dentition: DentitionStage;
  /** Per-position presence records (W5), applied over the dentition stage. */
  toothStatus: readonly ToothPresence[];
  /** 12 px cells for the full chart, 8 px for the compact one. */
  size: 12 | 8;
  /** The selected tooth. Passing it (even `null`) makes each tooth a toggle with `aria-pressed`;
   * a chart without selection (the compact one) leaves it out. */
  selected?: ToothCode | null;
  /** Without it the teeth are not interactive: each column is a labelled image, not a button. */
  onToothClick?: (code: ToothCode) => void;
}

type Arch = 'upper' | 'lower';

/**
 * The dental chart (spec §Dental Chart): one column per anatomical position, laid out by the
 * clinic's orientation and resolved to the tooth actually present (`presentTooth`). Numbers sit
 * outside the arches — above the upper, below the lower — with R/L markers on the full chart.
 * Always `dir="ltr"` (W17): it is never mirrored, even in an RTL layout; only the orientation
 * setting flips it. The arch block scrolls horizontally as one unit. Presentational: the caller
 * owns the data, the selection and what a click does.
 */
export function DentalChart({
  teeth,
  dentition,
  toothStatus,
  size,
  selected,
  onToothClick,
}: DentalChartProps) {
  const { t, i18n } = useTranslation('clinical');
  // The chart is LTR, but its text (titles, markers) reads in the locale's direction.
  const textDir = i18n.dir();
  const { mode, notation, orientation } = useChartSettings();
  const toothName = useToothName();
  const presence = new Map(toothStatus.map((record) => [record.position, record.present]));
  const { upper, lower } = archColumns(orientation);
  const full = size === 12;

  // Primary glyphs are smaller, so each sits in a constant-height box aligned to the occlusal
  // plane, and every column is exactly the full glyph's width (never wider, whatever its number
  // row holds): number rows, the midline and the upper/lower columns all stay straight.
  const { width: columnWidth, height: glyphHeight } = chartGlyphBox(mode, size);

  const renderTooth = (column: PermanentToothCode, arch: Arch) => {
    const { code, notErupted } = presentTooth(column, dentition, presence.get(column));
    const tooth = teeth.get(code);
    const isSelected = selected === code;
    const label = toothLabel(code, notation);
    const title = toothTitle(t, {
      label,
      name: toothName(code),
      primary: isPrimary(code),
      notErupted,
      tooth,
    });

    // The number stays LTR so the diagnosis dot always follows it. The dot hangs off the number's
    // end, out of the flow, so the number itself stays centred over its glyph.
    const number = (
      <span
        data-number
        dir="ltr"
        className={cn(
          'relative font-mono leading-none tabular-nums',
          full ? 'text-[12.5px]' : 'text-[11.5px]',
          isSelected ? 'font-semibold text-primary' : 'font-medium text-ink-muted',
          notErupted && 'italic',
        )}
      >
        {label.replace(/^#/, '')}
        {tooth?.hasActiveDiagnosis && (
          <span
            data-diagnosis-dot
            className={cn(
              'absolute start-full top-1/2 -translate-y-1/2 rounded-full bg-danger',
              full ? 'ms-[3px] size-1' : 'ms-[2px] size-[3px]',
            )}
          />
        )}
      </span>
    );
    const glyph = (
      <span
        dir="ltr"
        className={cn('flex justify-center', arch === 'upper' ? 'items-end' : 'items-start')}
        style={{ height: glyphHeight }}
      >
        <ToothGlyph
          variant="chart"
          code={code}
          tooth={tooth}
          mode={mode}
          orientation={orientation}
          size={size}
          selected={isSelected}
          notErupted={notErupted}
        />
      </span>
    );

    const columnClass = cn(
      'flex flex-none flex-col items-center',
      full ? 'gap-[5px]' : 'gap-[3px]',
    );
    const content = (
      <>
        {arch === 'upper' ? number : glyph}
        {arch === 'upper' ? glyph : number}
      </>
    );

    if (!onToothClick) {
      return (
        <div
          key={column}
          role="img"
          dir={textDir}
          data-column={column}
          title={title}
          aria-label={title}
          className={columnClass}
          style={{ width: columnWidth }}
        >
          {content}
        </div>
      );
    }
    return (
      <button
        key={column}
        type="button"
        dir={textDir}
        data-column={column}
        title={title}
        aria-label={title}
        aria-pressed={selected === undefined ? undefined : isSelected}
        onClick={() => {
          onToothClick(code);
        }}
        className={cn(columnClass, 'cursor-pointer border-0 bg-transparent p-0')}
        style={{ width: columnWidth }}
      >
        {content}
      </button>
    );
  };

  const row = (arch: Arch, columns: readonly PermanentToothCode[]) => (
    <div
      role="group"
      aria-label={t(arch === 'upper' ? 'chart.upperArch' : 'chart.lowerArch')}
      className={cn('flex', full ? 'gap-[5px]' : 'gap-[3px]')}
    >
      {columns.map((column) => renderTooth(column, arch))}
    </div>
  );

  const marker = (side: 'right' | 'left') => (
    <span
      aria-hidden
      dir={textDir}
      title={t(side === 'right' ? 'chart.rightTitle' : 'chart.leftTitle')}
      className="min-w-[14px] text-center font-mono text-[11.5px] leading-none font-medium text-ink-muted"
    >
      {t(side === 'right' ? 'chart.right' : 'chart.left')}
    </span>
  );
  const patientRightOnRight = orientation === 'patient_right_on_right';

  return (
    <div data-dental-chart dir="ltr" className="overflow-x-auto">
      <div className="mx-auto flex w-max items-center gap-3 p-1.5">
        {full && marker(patientRightOnRight ? 'left' : 'right')}
        <div className={cn('flex flex-col', full ? 'gap-[11px]' : 'gap-[9px]')}>
          {row('upper', upper)}
          <div className="h-px bg-border" />
          {row('lower', lower)}
        </div>
        {full && marker(patientRightOnRight ? 'right' : 'left')}
      </div>
    </div>
  );
}
