import { type ReactNode, useState } from 'react';
import { SaveGroupsContext } from './save-groups-context';
import { SaveGroupsStore } from './save-groups-store';

/** Holds one visit workspace's autosaved field groups, keyed (spec V6/W6). Mount it per visit
 * (e.g. `key={visitId}`) so groups never carry over from one visit to another. */
export function SaveGroupsProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new SaveGroupsStore());
  return <SaveGroupsContext.Provider value={store}>{children}</SaveGroupsContext.Provider>;
}
