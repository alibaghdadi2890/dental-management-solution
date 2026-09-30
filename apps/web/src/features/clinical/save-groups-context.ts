import { createContext, useContext } from 'react';

/** How a save group tells the workspace it has (or no longer has) unsaved local edits. */
export type ReportDirty = (groupId: string, dirty: boolean) => void;

const ignore: ReportDirty = () => undefined;

/** Split in two so reporting never re-renders the groups, only the readers of `anyDirty`. */
export const ReportDirtyContext = createContext<ReportDirty>(ignore);
export const AnyGroupDirtyContext = createContext(false);

/** A group outside a `SaveGroupsProvider` reports to nobody. */
export function useReportDirty(): ReportDirty {
  return useContext(ReportDirtyContext);
}

/** True while any save group in the workspace has unsaved local edits (W6 pauses the refetch). */
export function useAnyGroupDirty(): boolean {
  return useContext(AnyGroupDirtyContext);
}
