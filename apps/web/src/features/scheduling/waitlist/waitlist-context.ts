import { createContext, useContext } from 'react';
import type { WaitlistEntryDraft } from './waitlist-entry-panel';

/** The shell's two waitlist panels (S2), opened from any page. */
export interface WaitlistPanels {
  /** *Fill*: the opening of a freed appointment (the one holding `at` when it is split). */
  openFill: ((appointmentId: string, at?: string) => void) | null;
  /** *Add to waitlist* or *Edit*; null without `appointment:write`. */
  openEntry: ((draft: WaitlistEntryDraft) => void) | null;
}

export const WaitlistContext = createContext<WaitlistPanels>({ openFill: null, openEntry: null });

export function useWaitlistPanels(): WaitlistPanels {
  return useContext(WaitlistContext);
}
