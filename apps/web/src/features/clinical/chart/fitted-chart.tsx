import { archColumns, type DentitionStage } from '@dcm/contracts';
import { type ReactNode, useRef } from 'react';
import { useFittedCellSize } from './fit-cell-size';
import { useChartSettings } from './use-chart-settings';

/**
 * The space a full chart is drawn in, and the cell size that suits it: 12 px, or while
 * `expanded` the largest cell (up to 20 px) at which a whole jaw fits the space without
 * scrolling. The caller draws the chart at the size it is handed.
 */
export function FittedChart({
  expanded,
  dentition,
  withAreas,
  children,
}: {
  expanded: boolean;
  dentition: DentitionStage;
  /** The chart has jaw bars (`onAreaClick`), which make each jaw a little wider. */
  withAreas: boolean;
  children: (size: number) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { mode, orientation } = useChartSettings();
  const columns = archColumns(orientation, dentition).upper.length;
  const size = useFittedCellSize(ref, expanded, { mode, columns, withAreas });
  return (
    <div ref={ref} data-chart-fit className="min-w-0">
      {children(size)}
    </div>
  );
}
