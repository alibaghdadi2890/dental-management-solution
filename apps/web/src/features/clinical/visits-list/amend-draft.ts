import {
  type AmendVisitInput,
  type DiscountMode,
  type SurfaceKey,
  type ToothCode,
  validSurfaces,
  type VisitListItem,
  visitMoney,
} from '@dcm/contracts';

/** One service while amending: kept or removed, and (per-tooth only) its tooth and surfaces. */
export interface AmendLine {
  id: string;
  removed: boolean;
  toothCode: ToothCode | null;
  surfaces: SurfaceKey[];
}

/** The amend form's state (D1): the services and the visit discount. */
export interface AmendDraft {
  lines: AmendLine[];
  discount: { mode: DiscountMode; value: string };
}

export function draftOf(visit: VisitListItem): AmendDraft {
  return {
    lines: visit.services.map((service) => ({
      id: service.id,
      removed: false,
      toothCode: service.toothCode,
      surfaces: [...service.surfaces],
    })),
    discount: { ...visit.discount },
  };
}

const sameSurfaces = (a: readonly SurfaceKey[], b: readonly SurfaceKey[]) =>
  [...a].sort().join() === [...b].sort().join();

const sameAmount = (a: string, b: string) => Number(a) === Number(b);

/** Anything changed from the visit as it is: Save stays disabled until then. */
export function isDirty(draft: AmendDraft, visit: VisitListItem): boolean {
  const discountChanged =
    draft.discount.mode !== visit.discount.mode ||
    !sameAmount(draft.discount.value || '0', visit.discount.value);
  return (
    discountChanged ||
    draft.lines.some((line) => {
      const service = visit.services.find((candidate) => candidate.id === line.id);
      return (
        line.removed ||
        service === undefined ||
        line.toothCode !== service.toothCode ||
        !sameSurfaces(line.surfaces, service.surfaces)
      );
    })
  );
}

export type AmendProblem = 'noService' | 'tooth' | 'discount';

/** Why Save can't go ahead yet, if anything: every service removed (void instead, D3), a
 * per-tooth service without a valid tooth and surfaces, or a discount that isn't a number. */
export function problemOf(draft: AmendDraft): AmendProblem | null {
  if (draft.lines.every((line) => line.removed)) return 'noService';
  const kept = draft.lines.filter((line) => !line.removed);
  if (
    kept.some((line) => line.toothCode !== null && !validSurfaces(line.toothCode, line.surfaces))
  ) {
    return 'tooth';
  }
  const value = draft.discount.value.trim();
  if (value !== '' && !/^\d{1,10}(\.\d{1,2})?$/.test(value)) return 'discount';
  return null;
}

/** The visit total after the draft, with the server's arithmetic (`visitMoney`, cap included). */
export function draftTotal(draft: AmendDraft, visit: VisitListItem): string {
  const lines = visit.services
    .filter((service) => draft.lines.some((line) => line.id === service.id && !line.removed))
    .map((service) => ({ base: service.final.amount, discount: '0' }));
  return visitMoney(lines, draft.discount.mode, draft.discount.value.trim() || '0').total;
}

/** The request body: the services that stay, with their tooth and surfaces when per-tooth. */
export function amendInput(
  draft: AmendDraft,
  visit: VisitListItem,
  reason: string,
): AmendVisitInput {
  return {
    expectedUpdatedAt: visit.updatedAt,
    reason,
    discount: { mode: draft.discount.mode, value: draft.discount.value.trim() || '0' },
    services: draft.lines
      .filter((line) => !line.removed)
      .map((line) =>
        line.toothCode === null
          ? { id: line.id }
          : { id: line.id, toothCode: line.toothCode, surfaces: line.surfaces },
      ),
  };
}
