import {
  idSchema,
  isoDateSchema,
  LAB_ORDER_STATUSES,
  LAB_REPORT_GROUPS,
  type LabOrderStatus,
  type LabReportGroup,
} from '@dcm/contracts';
import { z } from 'zod';
import type { LabOrderFilter } from './labs-api';

export const LAB_TABS = ['orders', 'labs', 'reports'] as const;
export type LabTab = (typeof LAB_TABS)[number];

/** One lab's page (`/labs/:labId`): its tab, the statement's period and an open order. */
export const LAB_DETAIL_TABS = ['statement', 'services', 'orders'] as const;
export type LabDetailTab = (typeof LAB_DETAIL_TABS)[number];

export type LabDetailSearch = {
  tab?: LabDetailTab | undefined;
  from?: string | undefined;
  to?: string | undefined;
  order?: string | undefined;
};

/**
 * The Lab screen's URL: the tab; the Orders filter (status — open by default —, lab, dentist,
 * branch, late only, period, search, and the ids behind a report figure); the open order; the report's period and grouping. Anything malformed is dropped, never an error.
 */
export interface LabSearch {
  tab?: Exclude<LabTab, 'orders'> | undefined;
  status?: LabOrderStatus | 'all' | undefined;
  lab?: string | undefined;
  dentist?: string | undefined;
  branch?: string | undefined;
  late?: true | undefined;
  from?: string | undefined;
  to?: string | undefined;
  q?: string | undefined;
  ids?: string | undefined;
  order?: string | undefined;
  group?: Exclude<LabReportGroup, 'lab'> | undefined;
  rfrom?: string | undefined;
  rto?: string | undefined;
}

const optionalId = idSchema.optional().catch(undefined);
const optionalDate = isoDateSchema.optional().catch(undefined);

const schema = z.object({
  tab: z.enum(['labs', 'reports']).optional().catch(undefined),
  status: z
    .enum([...LAB_ORDER_STATUSES, 'all'])
    .optional()
    .catch(undefined),
  lab: optionalId,
  dentist: optionalId,
  branch: optionalId,
  late: z
    .union([z.literal(true), z.literal('true')])
    .optional()
    .catch(undefined)
    .transform((value) => (value === undefined ? undefined : (true as const))),
  from: optionalDate,
  to: optionalDate,
  q: z.string().trim().max(100).optional().catch(undefined),
  ids: z
    .string()
    .regex(/^[0-9a-f,-]+$/i)
    .max(20_000)
    .optional()
    .catch(undefined),
  order: optionalId,
  group: z
    .enum(LAB_REPORT_GROUPS.filter((group) => group !== 'lab') as ['dentist', 'service'])
    .optional()
    .catch(undefined),
  rfrom: optionalDate,
  rto: optionalDate,
});

export function parseLabSearch(raw: Record<string, unknown>): LabSearch {
  const parsed = schema.parse(raw);
  return Object.fromEntries(
    Object.entries({ ...parsed, q: parsed.q === '' ? undefined : parsed.q }).filter(
      ([, value]) => value !== undefined,
    ),
  );
}

/** The orders the URL asks for: open ones unless a status (or *all*) is chosen. */
export function filterOf(search: LabSearch): LabOrderFilter {
  const ids = search.ids?.split(',').filter((id) => id.length > 0);
  return {
    status:
      ids && ids.length > 0
        ? undefined
        : search.status === 'all'
          ? undefined
          : (search.status ?? 'open'),
    labId: search.lab,
    dentistId: search.dentist,
    branchId: search.branch,
    late: search.late,
    from: search.from,
    to: search.to,
    q: search.q,
    ids: ids && ids.length > 0 ? ids : undefined,
  };
}
