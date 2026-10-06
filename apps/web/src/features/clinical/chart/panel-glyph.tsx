import {
  cellMark,
  type ChartMode,
  type ChartOrientation,
  type SurfaceKey,
  surfaceCells,
  type ToothCode,
  type ToothState,
  type ToothVisualState,
} from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { CELL_MAP, cellClass, gridStyle } from './glyph-style';
import { useSurfaceLabel } from './use-chart-settings';

export interface PanelGlyphProps {
  code: ToothCode;
  /** Absent when nothing is recorded on the tooth. */
  tooth: ToothState | undefined;
  mode: ChartMode;
  orientation: ChartOrientation;
  /** The surfaces scoped for the next service. */
  pendingSurfaces?: readonly SurfaceKey[];
  /** Toggles a surface in the pending scope. Without it the surfaces are read-only (W18). */
  onSurfaceClick?: (surface: SurfaceKey) => void;
}

const CELL = 24;
/** The simple-mode panel glyph is a fixed 52×64 cell (spec §Selected Tooth Panel). */
const SIMPLE = { width: 52, height: 64, radius: 8 } as const;

/** The panel shows what was done to each surface, not the plan wash: planned and in-progress
 * read as untreated. */
function panelMark(tooth: ToothState | undefined, surface: SurfaceKey): ToothVisualState {
  const mark = cellMark(tooth, surface);
  return mark === 'planned' || mark === 'in_progress' ? 'none' : mark;
}

const SURFACE_CLASS: Record<'pending' | ToothVisualState, string> = {
  pending: 'border-primary-hover bg-primary text-primary-foreground',
  treated_today: 'border-primary-tint-strong bg-primary text-primary-foreground',
  treated: 'border-primary-tint-strong bg-primary-tint-border text-ink-secondary',
  in_progress: 'border-border-control bg-surface text-ink-secondary',
  planned: 'border-border-control bg-surface text-ink-secondary',
  none: 'border-border-control bg-surface text-ink-secondary',
};

/**
 * The selected-tooth panel's enlarged glyph (spec §Selected Tooth Panel): in surface mode a 3×3
 * grid of 24 px surfaces, each showing its letter and toggling the pending scope; in simple mode
 * one 52×64 whole-tooth cell that is never clickable. A surface's name says whether it was
 * treated on its own or as part of a whole-tooth service.
 */
export function PanelGlyph({
  code,
  tooth,
  mode,
  orientation,
  pendingSurfaces = [],
  onSurfaceClick,
}: PanelGlyphProps) {
  const { t } = useTranslation('clinical');
  const surfaceLabel = useSurfaceLabel();

  if (mode === 'simple') {
    // The panel's tooth is the selected one, so its outline is the accent (as in the POC).
    const mark = tooth?.state ?? 'none';
    return (
      <span
        aria-hidden
        data-glyph
        className="grid flex-none"
        style={{ gridTemplateColumns: `${SIMPLE.width}px`, gridTemplateRows: `${SIMPLE.height}px` }}
      >
        <span
          data-mark={mark}
          className={cellClass(mark, true)}
          style={{ borderRadius: SIMPLE.radius }}
        />
      </span>
    );
  }

  const surfaces = surfaceCells(code, orientation);
  return (
    <div
      role="group"
      aria-label={t('glyph.surfaces')}
      data-glyph
      className="grid flex-none"
      style={gridStyle(CELL, 2, 0)}
    >
      {CELL_MAP.map((index, position) => {
        if (index === null) return <span key={position} />;
        const surface = surfaces[index];
        const mark = panelMark(tooth, surface);
        const pending = pendingSurfaces.includes(surface);
        const name = t('glyph.surfaceName', {
          name: surfaceLabel.name(surface),
          short: surfaceLabel.short(surface),
        });
        const wholeToothOnly = mark !== 'none' && tooth?.surfaces[surface] === undefined;
        const label =
          mark === 'none'
            ? name
            : t(wholeToothOnly ? 'glyph.surfaceWholeTooth' : 'glyph.surfaceTreated', { name });
        const className = cn(
          'grid place-items-center rounded-[2px] border p-0 text-[12.5px] leading-none font-semibold',
          SURFACE_CLASS[pending ? 'pending' : mark],
        );

        if (!onSurfaceClick) {
          return (
            <span
              key={position}
              role="img"
              data-surface={surface}
              data-mark={mark}
              title={label}
              aria-label={label}
              className={className}
            >
              {surfaceLabel.short(surface)}
            </span>
          );
        }
        return (
          <button
            key={position}
            type="button"
            data-surface={surface}
            data-mark={mark}
            title={label}
            aria-label={label}
            aria-pressed={pending}
            onClick={() => {
              onSurfaceClick(surface);
            }}
            className={cn(className, 'cursor-pointer')}
          >
            {surfaceLabel.short(surface)}
          </button>
        );
      })}
    </div>
  );
}
