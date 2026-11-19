import { createContext, useContext } from 'react';

/** Opens the Take out panel for one item of a branch; null without `inventory:write`. */
export type OpenTakeOut = (itemId: string, branchId: string) => void;

export const TakeOutContext = createContext<OpenTakeOut | null>(null);

/** The shell's Take out panel (the search's _Take out_): null where it can't be opened. */
export function useOpenTakeOut(): OpenTakeOut | null {
  return useContext(TakeOutContext);
}
