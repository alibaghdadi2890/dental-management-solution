import { type ToothCode, toothCodeSchema } from '@dcm/contracts';
import { z } from 'zod';

/** `?tooth=`: the tooth to select on arrival (the tooth history's "Chart it in this visit").
 * The router reads a bare `16` as a number, so it is read back as text; an unknown code is
 * none. */
const workspaceSearchSchema = z.object({
  tooth: z.preprocess(
    (value) => (typeof value === 'number' ? String(value) : value),
    toothCodeSchema.optional().catch(undefined),
  ),
});

export interface WorkspaceSearch {
  tooth?: ToothCode | undefined;
}

/** Never throws, whatever TanStack Router hands `validateSearch`. */
export function parseWorkspaceSearch(raw: unknown): WorkspaceSearch {
  const { tooth } = workspaceSearchSchema.parse(raw && typeof raw === 'object' ? raw : {});
  return tooth === undefined ? {} : { tooth };
}
