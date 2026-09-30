import { useQuery } from '@tanstack/react-query';
import { useAnyGroupDirty } from './save-groups-context';
import { visitQuery } from './visits-api';

/** How often the workspace picks up another person's edits to the same live visit (W6). */
export const VISIT_REFETCH_MS = 10_000;

/**
 * The live visit for the workspace. Two people may edit one visit, last write wins per field
 * group (W6): it refetches whenever the window regains focus (however fresh the data), and every
 * 10 s while no save group below the `SaveGroupsProvider` has unsaved local edits. A refetch never
 * overwrites a dirty group anyway (`useSaveGroup`); pausing the poll just avoids the churn.
 */
export function useVisit(visitId: string) {
  const editing = useAnyGroupDirty();
  return useQuery({
    ...visitQuery(visitId),
    refetchOnWindowFocus: 'always',
    refetchInterval: editing ? false : VISIT_REFETCH_MS,
  });
}
