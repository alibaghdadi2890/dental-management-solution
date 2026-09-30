import { type ReactNode, useCallback, useState } from 'react';
import { AnyGroupDirtyContext, ReportDirtyContext } from './save-groups-context';

/** Collects which save groups below it are dirty (spec V6/W6); wraps one visit's workspace. */
export function SaveGroupsProvider({ children }: { children: ReactNode }) {
  const [dirtyGroups, setDirtyGroups] = useState<ReadonlySet<string>>(() => new Set());
  const report = useCallback((groupId: string, dirty: boolean) => {
    setDirtyGroups((current) => {
      if (current.has(groupId) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(groupId);
      else next.delete(groupId);
      return next;
    });
  }, []);
  return (
    <ReportDirtyContext.Provider value={report}>
      <AnyGroupDirtyContext.Provider value={dirtyGroups.size > 0}>
        {children}
      </AnyGroupDirtyContext.Provider>
    </ReportDirtyContext.Provider>
  );
}
