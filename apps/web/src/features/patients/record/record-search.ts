import { z } from 'zod';

/** The patient record's tabs (design §Patient record: Overview and Patient information only —
 * visits, the chart and payments arrive with their features). */
export const RECORD_TABS = ['overview', 'information'] as const;
export type RecordTab = (typeof RECORD_TABS)[number];

export const DEFAULT_RECORD_TAB: RecordTab = 'overview';

/** `?tab=`: an absent or unknown tab (a stale bookmark, a hand-edited URL) is the Overview. */
const recordSearchSchema = z.object({
  tab: z.enum(RECORD_TABS).catch(DEFAULT_RECORD_TAB),
});
export type RecordSearch = z.infer<typeof recordSearchSchema>;

/** What a `<Link>` or `navigate` may pass: the tab is optional (it defaults). */
export interface RecordSearchInput {
  tab?: RecordTab;
}

/** Never throws, whatever TanStack Router hands `validateSearch`. */
export function parseRecordSearch(raw: unknown): RecordSearch {
  return recordSearchSchema.parse(raw && typeof raw === 'object' ? raw : {});
}
