import {
  type DentitionStage,
  type ToothCode,
  toothCodeSchema,
  type ToothPresence,
} from '@dcm/contracts';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { z } from 'zod';
import { shownTooth } from '../chart/shown-tooth';

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

/**
 * Honours `?tooth=` once the chart is in: selects the tooth when it is the one the chart shows in
 * its position (a stale or hand-edited link naming the other tooth selects nothing), then leaves
 * the URL, so the selection stays the page's own.
 */
export function useToothParam({
  tooth,
  visitId,
  dentition,
  toothStatus,
  onSelect,
}: {
  tooth: ToothCode | undefined;
  visitId: string;
  /** `undefined` until the chart has loaded. */
  dentition: DentitionStage | undefined;
  toothStatus: readonly ToothPresence[];
  onSelect: (code: ToothCode) => void;
}): void {
  const navigate = useNavigate();
  useEffect(() => {
    if (tooth === undefined || dentition === undefined) return;
    if (shownTooth(tooth, dentition, toothStatus) === tooth) onSelect(tooth);
    void navigate({ to: '/visits/$visitId', params: { visitId }, search: {}, replace: true });
  }, [tooth, visitId, dentition, toothStatus, onSelect, navigate]);
}
