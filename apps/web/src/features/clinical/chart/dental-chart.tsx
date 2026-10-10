import {
  archColumns,
  type DentitionStage,
  markColorVars,
  type PermanentToothCode,
  presentTooth,
  type ToothCode,
  type ToothState,
  toothLabel,
} from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { chartGlyphBox } from './glyph-style';
import { ToothGlyph } from './tooth-glyph';
import type { ChartHighlight, ToothRender } from './tooth-render';
import { useChartSettings } from './use-chart-settings';
import { useChartView } from './use-chart-view';
import { useToothRender } from './use-tooth-render';

export interface DentalChartProps {
  /** `deriveChart`'s sparse map: a tooth absent from it has no recorded treatment. */
  teeth: ReadonlyMap<ToothCode, ToothState>;
  dentition: DentitionStage;
  /** 8 px cells for the compact chart, 12 px for the full one, and up to 20 px for the full
   * chart expanded across the page (`FittedChart`). */
  size: number;
  /** The selected tooth. Passing it (even `null`) makes each tooth a toggle with `aria-pressed`;
   * a chart without selection (the compact one) leaves it out. */
  selected?: ToothCode | null;
  /** Without it the teeth are not interactive: each column is a labelled image, not a button. */
  onToothClick?: (code: ToothCode) => void;
  /** The selected jaw or whole mouth. */
  area?: 'upper' | 'lower' | 'mouth' | null;
  /** With it the chart carries a bar over each jaw and a Whole mouth pill on the midline, each a
   * toggle: services and plans that aren't on a tooth are charted from there. */
  onAreaClick?: (area: 'upper' | 'lower' | 'mouth') => void;
  /** How many of today's services each area has, shown as a count on its bar or pill. */
  areaCounts?: Partial<Record<'upper' | 'lower' | 'mouth', number>>;
  /** The legend's highlighted item (M11): every tooth that does not carry it fades. */
  highlight?: ChartHighlight | null;
}

type Arch = 'upper' | 'lower';

/**
 * The dental chart (spec §Dental Chart): one of the patient's two charts — the 20 primary teeth or
 * the 32 permanent ones (`dentition`) — one column per position, laid out by the clinic's
 * orientation. Numbers sit
 * outside the arches — above the upper, below the lower — with R/L markers on the full chart.
 * Always `dir="ltr"` (W17): it is never mirrored, even in an RTL layout; only the orientation
 * setting flips it. The arch block scrolls horizontally as one unit. With `onAreaClick` each jaw
 * has a selectable bar outside its numbers and the midline a Whole mouth pill; a selected jaw (or
 * both, for the whole mouth) is outlined. Presentational: the caller
 * owns the data, the selection and what a click does.
 *
 * What each tooth shows follows this browser's chart view (feature 9): diagnoses, services, or
 * services with the diagnoses as coloured dots between the number and the glyph. Every tooth is
 * drawn from its `ToothRender`, which also words its title. The compact chart (under 12 px) is a
 * summary: no diagnosis dots, and the band as dots.
 */
export function DentalChart({
  teeth,
  dentition,
  size,
  selected,
  onToothClick,
  area = null,
  onAreaClick,
  areaCounts,
  highlight = null,
}: DentalChartProps) {
  const { t, i18n } = useTranslation('clinical');
  // The chart is LTR, but its text (titles, markers) reads in the locale's direction.
  const textDir = i18n.dir();
  const { mode, notation, orientation } = useChartSettings();
  const [view] = useChartView();
  const renderTooth = useToothRender();
  const { upper, lower } = archColumns(orientation, dentition);
  const full = size >= 12;
  // The expanded chart: its numbers and dots grow with its glyphs.
  const large = size >= 16;

  // Primary glyphs are smaller, so each sits in a constant-height box aligned to the occlusal
  // plane, and every column is exactly the full glyph's width (never wider, whatever its number
  // row holds): number rows, the midline and the upper/lower columns all stay straight.
  const { width: columnWidth, height: glyphHeight } = chartGlyphBox(mode, size);
  // Both view: a row between the number and the glyph holds the diagnosis dots. It is there for
  // every tooth, dots or not, so the rows stay straight.
  const dotRow = view === 'both' && full;
  const dotSize = large ? 6 : 5;

  const diagnosisDots = (render: ToothRender) => (
    <span
      data-dots
      className="flex items-center justify-center gap-[2px]"
      style={{ height: dotSize }}
    >
      {render.dots.map((dot, index) => (
        <span
          key={index}
          data-diagnosis-dot={dot.color ?? 'none'}
          className={cn(
            'flex-none rounded-full',
            dot.ringed && 'outline outline-[1.5px] outline-offset-1 outline-ink',
          )}
          style={{
            width: dotSize,
            height: dotSize,
            backgroundColor:
              dot.color === null ? 'var(--color-border-strong)' : markColorVars(dot.color).fill,
          }}
        />
      ))}
      {render.dotOverflow > 0 && (
        <span
          data-dot-overflow
          className="font-mono text-[8px] leading-none font-semibold text-ink-secondary"
        >
          +{render.dotOverflow}
        </span>
      )}
    </span>
  );

  const toothColumn = (column: PermanentToothCode, arch: Arch) => {
    const { code, notErupted } = presentTooth(column, dentition);
    const tooth = teeth.get(code);
    // What the dentist recorded (feature 7); without a record, a position the dentition has not
    // reached reads as not erupted.
    const recorded = tooth?.presence ?? 'present';
    const presence = recorded === 'present' && notErupted ? 'not_erupted' : recorded;
    const isSelected = selected === code;
    const label = toothLabel(code, notation);
    const render = renderTooth(code, tooth, {
      presence,
      selected: isSelected,
      compact: !full,
      highlight,
    });
    // The hover title has a line per item; the accessible name is the same words on one line.
    const { title } = render;
    const name = title.replaceAll('\n', ' · ');

    const number = (
      <span
        data-number
        dir="ltr"
        className={cn(
          'font-mono leading-none tabular-nums',
          large ? 'text-[14px]' : full ? 'text-[12.5px]' : 'text-[11.5px]',
          isSelected ? 'font-semibold text-primary' : 'font-medium text-ink-muted',
          presence !== 'present' && presence !== 'implant' && 'italic',
        )}
      >
        {label.replace(/^#/, '')}
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
          render={render}
          mode={mode}
          orientation={orientation}
          size={size}
        />
      </span>
    );

    const columnClass = cn(
      'flex flex-none flex-col items-center',
      large ? 'gap-[7px]' : full ? 'gap-[5px]' : 'gap-[3px]',
    );
    const dots = dotRow && diagnosisDots(render);
    const content = (
      <>
        {arch === 'upper' ? number : glyph}
        {dots}
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
          aria-label={name}
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
        aria-label={name}
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
      {columns.map((column) => toothColumn(column, arch))}
    </div>
  );

  const marker = (side: 'right' | 'left') => (
    <span
      aria-hidden
      dir={textDir}
      title={t(side === 'right' ? 'chart.rightTitle' : 'chart.leftTitle')}
      className={cn(
        'min-w-[14px] text-center font-mono leading-none font-medium text-ink-muted',
        large ? 'text-[13px]' : 'text-[11.5px]',
      )}
    >
      {t(side === 'right' ? 'chart.right' : 'chart.left')}
    </span>
  );
  const patientRightOnRight = orientation === 'patient_right_on_right';

  const areaButton = (target: 'upper' | 'lower' | 'mouth', className: string) => {
    if (!onAreaClick) return null;
    const pressed = area === target;
    const count = areaCounts?.[target] ?? 0;
    return (
      <button
        type="button"
        dir={textDir}
        aria-pressed={pressed}
        onClick={() => {
          onAreaClick(target);
        }}
        className={cn(
          'flex h-7 cursor-pointer items-center gap-2 border px-3 text-[11.5px] leading-none font-semibold tracking-[.06em] uppercase [&:lang(ar)]:tracking-normal',
          pressed
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-dashed border-divider-strong bg-transparent text-ink-muted hover:border-primary hover:text-primary',
          className,
        )}
      >
        {t(`level.${target}`)}
        {count > 0 && (
          <span
            data-area-count
            className={cn(
              'grid size-[18px] flex-none place-items-center rounded-full font-mono text-[11px] leading-none tracking-normal',
              pressed ? 'bg-surface text-primary' : 'bg-primary text-primary-foreground',
            )}
          >
            {count}
          </span>
        )}
      </button>
    );
  };
  /** A jaw: its bar outside the numbers, outlined while it (or the whole mouth) is selected. */
  const jaw = (arch: Arch, columns: readonly PermanentToothCode[]) =>
    onAreaClick ? (
      <div
        data-jaw={arch}
        className={cn(
          'flex flex-col gap-1.5 rounded-[10px] border p-1.5',
          area === arch || area === 'mouth'
            ? 'border-primary-tint-border bg-selected'
            : 'border-transparent',
        )}
      >
        {arch === 'upper' && areaButton('upper', 'rounded-md')}
        {row(arch, columns)}
        {arch === 'lower' && areaButton('lower', 'rounded-md')}
      </div>
    ) : (
      row(arch, columns)
    );

  return (
    <div data-dental-chart data-view={view} dir="ltr" className="overflow-x-auto">
      <div className="mx-auto flex w-max items-center gap-3 p-1.5">
        {full && marker(patientRightOnRight ? 'left' : 'right')}
        <div
          className={cn('flex flex-col', onAreaClick ? 'gap-1' : full ? 'gap-[11px]' : 'gap-[9px]')}
        >
          {jaw('upper', upper)}
          {onAreaClick ? (
            <div className="flex items-center gap-3 px-1.5">
              <span className="h-px flex-1 bg-border" />
              {areaButton('mouth', 'rounded-full')}
              <span className="h-px flex-1 bg-border" />
            </div>
          ) : (
            <div className="h-px bg-border" />
          )}
          {jaw('lower', lower)}
        </div>
        {full && marker(patientRightOnRight ? 'right' : 'left')}
      </div>
    </div>
  );
}
