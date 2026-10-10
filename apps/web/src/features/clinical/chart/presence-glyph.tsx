import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import type { AbsentPresence } from './presence-style';

/** The marks of a position that is not a plain natural tooth; what they mean is in
 * `presence-style.ts`. */

/**
 * The single box that stands for a missing or not-erupted position, the size of the glyph it
 * replaces. `planned` keeps the planned wash: an implant planned on a gap must still show.
 */
export function AbsentBox({
  presence,
  width,
  height,
  radius,
  planned = false,
  selected = false,
}: {
  presence: AbsentPresence;
  width: number;
  height: number;
  radius: number;
  planned?: boolean;
  selected?: boolean;
}) {
  const missing = presence === 'missing';
  const cross = Math.max(6, Math.round(Math.min(width, height) * 0.34));
  return (
    <span
      className={cn('relative grid place-items-center', missing && 'opacity-60')}
      style={{ width, height }}
    >
      <span
        data-fill={planned ? 'planned/wash' : 'none'}
        className={cn(
          'absolute inset-0 border-[1.5px]',
          missing ? 'border-dashed' : 'border-dotted',
          selected ? 'border-primary' : missing ? 'border-ink-muted' : 'border-border-strong',
          planned && 'bg-planned-bg',
        )}
        style={{ borderRadius: radius }}
      />
      {missing && (
        <svg
          data-presence-cross
          width={cross}
          height={cross}
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="relative text-ink-muted"
        >
          <path d="m2 2 6 6M8 2 2 8" />
        </svg>
      )}
    </span>
  );
}

/**
 * The implant's post: a short threaded shaft, centred on the root-side edge of the glyph, half
 * outside it. Sits in a `relative` glyph box; drawn with a light halo so it stays legible over a
 * filled surface.
 */
export function ImplantPost({ side, size }: { side: 'top' | 'bottom'; size: number }) {
  const width = Math.max(5, Math.round(size * 0.5));
  const height = Math.max(6, Math.round(size * 0.66));
  const style: CSSProperties = {
    width,
    height,
    [side]: -Math.round(height / 2) - 1,
  };
  return (
    <svg
      data-implant-post
      viewBox="0 0 6 8"
      fill="none"
      strokeLinecap="round"
      style={style}
      className="pointer-events-none absolute inset-x-0 mx-auto text-ink"
    >
      {/* The halo first, then the post over it. */}
      <path d="M3 .8v6.4M1 2.2h4M1.4 4h3.2M1.8 5.8h2.4" stroke="#fff" strokeWidth="2.4" />
      <path d="M3 .8v6.4M1 2.2h4M1.4 4h3.2M1.8 5.8h2.4" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}
