import { idSchema, type Permission } from '@dcm/contracts';
import { z } from 'zod';
import { useSession } from '@/features/auth/session';

/** The patient record's tabs (design §Patient record; Visits & history, the chart and payments
 * arrive with feature 4b). */
export const RECORD_TABS = [
  'overview',
  'history',
  'chart',
  'files',
  'balance',
  'information',
] as const;
export type RecordTab = (typeof RECORD_TABS)[number];

export const DEFAULT_RECORD_TAB: RecordTab = 'overview';

/** What a tab needs beyond reading the patient: visits for the history and chart, files for
 * the Files tab (feature 8), payments for the balance (the API is the enforcement point; this only hides what would fail). */
const TAB_PERMISSION: Partial<Record<RecordTab, Permission>> = {
  history: 'visit:read',
  chart: 'visit:read',
  files: 'file:read',
  balance: 'payment:read',
};

/** The record tabs the session may open, in order. */
export function useRecordTabs(): readonly RecordTab[] {
  const permissions = useSession().data?.permissions ?? [];
  return RECORD_TABS.filter((tab) => {
    const needed = TAB_PERMISSION[tab];
    return needed === undefined || permissions.includes(needed);
  });
}

/** The record's right panels, held in `?panel=` (design addendum "Record": Add contact). */
export const RECORD_PANELS = ['add-contact'] as const;
export type RecordPanel = (typeof RECORD_PANELS)[number];

/** Visits & history's two views (4b, D15). */
export const HISTORY_VIEWS = ['visits', 'clinical'] as const;
export type HistoryView = (typeof HISTORY_VIEWS)[number];

/** `?tab=`: an absent or unknown tab (a stale bookmark, a hand-edited URL) is the Overview.
 * `?panel=`: an unknown panel is none. `?visitId=` expands (and scrolls to) one visit in the
 * history; `?startVisit=1` opens the start-visit popover once (4a follow-up 5); `?file=` opens
 * one file in the viewer over the Files tab, then leaves the URL (the Activity screen's link). */
const recordSearchSchema = z.object({
  tab: z.enum(RECORD_TABS).catch(DEFAULT_RECORD_TAB),
  panel: z.enum(RECORD_PANELS).optional().catch(undefined),
  view: z.enum(HISTORY_VIEWS).optional().catch(undefined),
  visitId: idSchema.optional().catch(undefined),
  file: idSchema.optional().catch(undefined),
  startVisit: z
    .union([z.literal(1), z.literal('1'), z.literal(true)])
    .transform(() => true as const)
    .optional()
    .catch(undefined),
});
export type RecordSearch = z.infer<typeof recordSearchSchema>;

/** What a `<Link>` or `navigate` may pass: the tab is optional (it defaults). */
export interface RecordSearchInput {
  tab?: RecordTab;
  panel?: RecordPanel | undefined;
  view?: HistoryView | undefined;
  visitId?: string | undefined;
  file?: string | undefined;
  startVisit?: true | undefined;
}

/** Never throws, whatever TanStack Router hands `validateSearch`. */
export function parseRecordSearch(raw: unknown): RecordSearch {
  return recordSearchSchema.parse(raw && typeof raw === 'object' ? raw : {});
}
