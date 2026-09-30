import type { SurfaceKey } from '@dcm/contracts';
import { cn } from '@/lib/utils';
import { useChartSettings, useSurfaceLabel } from '../../chart/use-chart-settings';

/** A record's surface letters ("O · D"), through `useSurfaceLabel` (W25). Hidden in simple mode
 * and for a whole-tooth record (spec §Chart modes). */
export function SurfaceTag({
  surfaces,
  className,
}: {
  surfaces: readonly SurfaceKey[];
  className?: string;
}) {
  const { mode } = useChartSettings();
  const surfaceLabel = useSurfaceLabel();
  if (mode === 'simple' || surfaces.length === 0) return null;
  return (
    <span
      dir="ltr"
      className={cn(
        'flex-none text-[12.5px] leading-none font-semibold tracking-[.08em] [&:lang(ar)]:tracking-normal',
        className,
      )}
    >
      {surfaceLabel.format(surfaces)}
    </span>
  );
}
