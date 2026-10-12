import type { Jaw, ToothCode } from '@dcm/contracts';
import { useCallback } from 'react';
import { useLevelLabel, useToothLabel } from '../chart/use-chart-settings';

/** Where a record is: "#26" for a tooth, else its jaw or "Whole mouth". */
export function useTargetLabel(): (record: {
  toothCode: ToothCode | null;
  jaw?: Jaw | null | undefined;
}) => string {
  const toothLabel = useToothLabel();
  const levelLabel = useLevelLabel();
  return useCallback(
    ({ toothCode, jaw }) => (toothCode === null ? levelLabel(jaw ?? null) : toothLabel(toothCode)),
    [toothLabel, levelLabel],
  );
}
