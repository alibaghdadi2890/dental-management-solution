import { type ToothCode, toothCodeSchema } from '@dcm/contracts';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
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

/**
 * Honours `?tooth=` once the chart is in: selects the tooth — which brings its chart, primary or
 * permanent — then leaves the URL, so the selection stays the page's own.
 */
export function useToothParam({
  tooth,
  visitId,
  ready,
  onSelect,
}: {
  tooth: ToothCode | undefined;
  visitId: string;
  /** False until the chart has loaded. */
  ready: boolean;
  onSelect: (code: ToothCode) => void;
}): void {
  const navigate = useNavigate();
  useEffect(() => {
    if (tooth === undefined || !ready) return;
    onSelect(tooth);
    void navigate({ to: '/visits/$visitId', params: { visitId }, search: {}, replace: true });
  }, [tooth, visitId, ready, onSelect, navigate]);
}
