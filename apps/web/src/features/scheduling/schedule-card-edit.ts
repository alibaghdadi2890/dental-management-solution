import type { Appointment } from '@dcm/contracts';
import { createContext } from 'react';

/**
 * The cards' Edit button (ADR-0075): which cards have one, and what it opens. A context, so the
 * calendar's card components stay the same between renders.
 */
export const ScheduleCardEdit = createContext<{
  canEdit: (appointment: Appointment) => boolean;
  onEdit: (appointment: Appointment) => void;
} | null>(null);
