import {
  type ChartMode,
  type ChartOrientation,
  type SurfaceKey,
  surfaceCells,
  type ToothCode,
} from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { CELL_MAP, fillName, fillStyle, gridStyle } from './glyph-style';
import { ImplantPost } from './presence-glyph';
import { IMPLANT_OUTLINE, isAbsent, rootSide } from './presence-style';
import type { Fill, ToothRender } from './tooth-render';
import { useSurfaceLabel } from './use-chart-settings';

export interface PanelGlyphProps {
  code: ToothCode;
  /** What to draw (`toToothRender`). The panel draws its presence itself, so the surfaces stay
   * workable whatever is at the position (H3): a crown is charted on an implant, a pontic on a
   * gap. */
  render: ToothRender;
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

/** The panel shows what is on each surface, not the plan wash: a planned surface reads as a
 * plain one. */
function marked(fill: Fill | null | undefined): Fill | undefined {
  return fill && fill.color !== 'planned' && fill.color !== 'none' ? fill : undefined;
}

/**
 * The selected-tooth panel's enlarged glyph (spec §Selected Tooth Panel), drawn from the same
 * `ToothRender` as the chart's (feature 9): in surface mode a 3×3 grid of 24 px surfaces, each
 * showing its letter in the colour of the mark on it and toggling the pending scope; in simple
 * mode one 52×64 whole-tooth cell that is never clickable. A surface's name says which diagnosis
 * or service is on it. The band's marks are listed as text by the panel, under the glyph.
 */
export function PanelGlyph({
  code,
  render,
  mode,
  orientation,
  pendingSurfaces = [],
  onSurfaceClick,
}: PanelGlyphProps) {
  const { t } = useTranslation('clinical');
  const surfaceLabel = useSurfaceLabel();
  const { presence } = render;
  const absent = isAbsent(presence);
  // Missing: dashed and faded; not erupted: dotted; implant: a second outline and its post.
  const presenceClass = cn(
    'relative',
    presence === 'implant' && cn('rounded-[5px]', IMPLANT_OUTLINE),
    presence === 'missing' && 'opacity-60',
  );
  const cellBorder =
    presence === 'missing' ? 'border-dashed' : presence === 'not_erupted' ? 'border-dotted' : '';
  const overlay = (
    <>
      {presence === 'implant' && <ImplantPost side={rootSide(code)} size={CELL} />}
      {presence === 'missing' && (
        <svg
          aria-hidden
          data-presence-cross
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.9"
          strokeLinecap="round"
          className="pointer-events-none absolute inset-0 m-auto size-[26px] text-ink-muted"
        >
          <path d="m2 2 6 6M8 2 2 8" />
        </svg>
      )}
    </>
  );

  if (mode === 'simple') {
    // The panel's tooth is the selected one, so a plain body's outline is the accent (as in the
    // POC). An absent position has no body fill in the render.
    const fill = marked(render.body);
    return (
      <span
        aria-hidden
        data-glyph
        data-presence={presence}
        className={cn('grid flex-none', presenceClass)}
        style={{ gridTemplateColumns: `${SIMPLE.width}px`, gridTemplateRows: `${SIMPLE.height}px` }}
      >
        <span
          data-body
          data-fill={fillName(absent ? undefined : fill)}
          className={cn('border', cellBorder)}
          style={{ borderRadius: SIMPLE.radius, ...fillStyle(absent ? undefined : fill, true) }}
        />
        {overlay}
      </span>
    );
  }

  const surfaces = surfaceCells(code, orientation);
  return (
    <div
      role="group"
      aria-label={t('glyph.surfaces')}
      data-glyph
      data-presence={presence}
      className={cn('grid flex-none', presenceClass)}
      style={gridStyle(CELL, 2, 0)}
    >
      {CELL_MAP.map((index, position) => {
        if (index === null) return <span key={position} />;
        const surface = surfaces[index];
        const fill = marked(render.cells[surface]);
        const pending = pendingSurfaces.includes(surface);
        const name = t('glyph.surfaceName', {
          name: surfaceLabel.name(surface),
          short: surfaceLabel.short(surface),
        });
        const label = fill?.label ? t('glyph.surfaceMarked', { name, item: fill.label }) : name;
        const className = cn(
          'grid place-items-center rounded-[2px] border p-0 text-[12.5px] leading-none font-semibold',
          pending
            ? 'border-primary-hover bg-primary text-primary-foreground'
            : !fill && 'text-ink-secondary',
          cellBorder,
        );
        const style = pending ? undefined : fillStyle(fill, false);

        if (!onSurfaceClick) {
          return (
            <span
              key={position}
              role="img"
              data-surface={surface}
              data-fill={fillName(fill)}
              title={label}
              aria-label={label}
              className={className}
              style={style}
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
            data-fill={fillName(fill)}
            title={label}
            aria-label={label}
            aria-pressed={pending}
            onClick={() => {
              onSurfaceClick(surface);
            }}
            className={cn(className, 'cursor-pointer')}
            style={style}
          >
            {surfaceLabel.short(surface)}
          </button>
        );
      })}
      {overlay}
    </div>
  );
}
