import type { PlanPriority } from '@dcm/contracts';

/** The design's three tones: urgent in red, high in amber, elective neutral. */
export const PRIORITY_TONE: Record<PlanPriority, string> = {
  urgent: 'border-danger-border bg-danger-bg text-danger',
  high: 'border-warning-border bg-warning-bg text-warning',
  elective: 'border-border bg-subtle text-ink-secondary',
};
