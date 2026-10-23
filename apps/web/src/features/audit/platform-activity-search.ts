import { ACTIVITY_AREAS, type ActivityArea, idSchema } from '@dcm/contracts';
import { z } from 'zod';
import { ACTIVITY_RANGES, type ActivityRange } from './activity-search';

/**
 * The URL of `/admin/activity` (ADR-0057): the clinic, the area, a person of that clinic and the
 * date range. Everything is optional; a bad value reads as "not set".
 */
export interface PlatformActivitySearch {
  tenant?: string | undefined;
  area?: ActivityArea | undefined;
  /** A staff member's user id, in the chosen clinic only. */
  person?: string | undefined;
  range: ActivityRange;
}

export const PLATFORM_ACTIVITY_DEFAULTS = { range: '7d' } as const;

const searchSchema = z.object({
  tenant: idSchema.optional().catch(undefined),
  area: z.enum(ACTIVITY_AREAS).optional().catch(undefined),
  person: idSchema.optional().catch(undefined),
  range: z.enum(ACTIVITY_RANGES).catch(PLATFORM_ACTIVITY_DEFAULTS.range),
});

export function parsePlatformActivitySearch(
  search: Partial<Record<keyof PlatformActivitySearch, unknown>>,
): PlatformActivitySearch {
  return searchSchema.parse(search);
}
