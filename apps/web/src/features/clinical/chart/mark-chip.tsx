import { type MarkColor, type MarkIcon, markColorVars } from '@dcm/contracts';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { MarkIconGlyph } from './mark-icons';

/** Under this an icon is strokes thinner than a pixel: the chip shows its colour alone. */
const MIN_ICON = 8;

/** How a mark is filled (feature 9, M2): work of today is the saturated fill with a strong edge;
 * earlier work is the same hue as a mid-tone with the default border. An item whose catalog
 * colour is unknown is a plain bordered box. */
function markFillStyle(color: MarkColor | null, tone: 'today' | 'past'): CSSProperties {
  if (color === null) {
    return { backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-strong)' };
  }
  const vars = markColorVars(color);
  return tone === 'today'
    ? { backgroundColor: vars.fill, borderColor: vars.strong, color: vars.on }
    : {
        backgroundColor: vars.tint,
        borderColor: 'var(--color-border-control)',
        color: vars.strong,
      };
}

/**
 * One chart mark as a chip: a diagnosis is its colour (round), a service its icon on its colour
 * (square; the colour alone when it has no icon). The same chip sits in a tooth's band, in the
 * legend, in the lists and in the Catalog pickers, so they all read alike. Decorative: whoever
 * shows it names the item in text.
 */
export function MarkChip({
  kind,
  color,
  icon = null,
  tone = 'today',
  size,
  width = size,
  ringed = false,
  className,
  ...data
}: {
  kind: 'diagnosis' | 'service';
  color: MarkColor | null;
  icon?: MarkIcon | null;
  tone?: 'today' | 'past';
  /** The chip's height, in px; its width too unless `width` narrows it (a crowded band). */
  size: number;
  width?: number;
  /** The legend's highlighted item (M11). */
  ringed?: boolean;
  className?: string;
  'data-chip'?: string;
}) {
  const iconSize = Math.min(size, width) - 2;
  return (
    <span
      aria-hidden
      {...data}
      data-tone={tone}
      data-ringed={ringed || undefined}
      className={cn(
        'grid flex-none place-items-center',
        tone === 'today' ? 'border-[1.5px]' : 'border',
        kind === 'diagnosis' && 'rounded-full',
        ringed && 'outline outline-[1.5px] outline-offset-1 outline-ink',
        className,
      )}
      style={{
        width,
        height: size,
        ...(kind === 'service' && { borderRadius: Math.max(1.5, size * 0.2) }),
        ...markFillStyle(color, tone),
      }}
    >
      {kind === 'service' && icon && iconSize >= MIN_ICON && (
        <MarkIconGlyph icon={icon} size={iconSize} />
      )}
    </span>
  );
}
