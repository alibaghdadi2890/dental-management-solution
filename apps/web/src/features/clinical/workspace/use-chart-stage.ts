import { type DentitionStage, isPrimary, type ToothCode } from '@dcm/contracts';
import { useState } from 'react';

/** The chart a tooth is on. */
export const chartOf = (code: ToothCode): DentitionStage =>
  isPrimary(code) ? 'primary' : 'permanent';

/**
 * Which of the patient's two charts is on screen: the patient's own (the one they were switched
 * to, else the one their age opens on) until the viewer switches, and always the chart of the
 * selected tooth — selecting a primary tooth from the plan board while the permanent chart is up
 * brings the primary chart. `undefined` until the patient's chart has loaded.
 */
export function useChartStage(
  patientStage: DentitionStage | undefined,
  selected: ToothCode | null,
): [DentitionStage | undefined, (stage: DentitionStage) => void] {
  const [view, setView] = useState<DentitionStage | null>(null);
  const stage = view ?? patientStage;
  const wanted = selected === null ? null : chartOf(selected);
  // Follows the selection during render, so the chart never draws without its selected tooth.
  if (stage !== undefined && wanted !== null && wanted !== stage) setView(wanted);
  return [wanted ?? stage, setView];
}
