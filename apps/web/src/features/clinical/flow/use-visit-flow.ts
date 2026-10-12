import {
  doneSteps,
  type PatientChart,
  stepsOf,
  type Visit,
  type VisitStep,
  type VisitType,
  type VisitViewMode,
} from '@dcm/contracts';
import { MutationObserver, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { usePermission } from '@/features/auth/use-permission';
import { patientFilesQuery } from '@/features/files/files-api';
import { visitFiles } from '@/features/files/gallery/gallery-filter';
import { useVisitMutations } from '../visit-mutations';
import { visitFlowFacts } from './visit-facts';

export interface VisitFlow {
  type: VisitType;
  /** The visit's steps, in order. */
  steps: readonly VisitStep[];
  /** The step it is on: always one of `steps`. */
  current: VisitStep;
  /** The steps that hold a record: they show a tick instead of their number. */
  done: ReadonlySet<VisitStep>;
  view: VisitViewMode;
  previous: VisitStep | null;
  next: VisitStep | null;
  /** Opens a step. In the All view it also returns to the steps: the stepper still navigates. */
  goTo: (step: VisitStep) => void;
  setView: (view: VisitViewMode) => void;
}

/**
 * Where a visit is in its flow (feature 10, ADR-0044): its steps, the one it is on and the ones
 * that are done, which the shared step model derives from what the visit holds. A click moves
 * at once and is stored behind it (last write wins), so a paused visit, another screen or another
 * device opens on the same step and view. Someone who may not write the visit still moves
 * through the steps; nothing is stored for them.
 */
export function useVisitFlow(visit: Visit, chart: PatientChart | undefined): VisitFlow {
  const queryClient = useQueryClient();
  const mutations = useVisitMutations(visit.id);
  const live = visit.status === 'in_progress' || visit.status === 'paused';
  const canStore = usePermission('visit:write') && live;
  const canReadFiles = usePermission('file:read');
  const files = useQuery({ ...patientFilesQuery(visit.patientId), enabled: canReadFiles });
  const fileCount = visitFiles(files.data ?? [], visit.id).length;
  // What was clicked here, ahead of the visit that answers it.
  const [picked, setPicked] = useState<{ step?: VisitStep; view?: VisitViewMode }>({});

  const facts = useMemo(() => visitFlowFacts(visit, chart, fileCount), [visit, chart, fileCount]);
  const steps = stepsOf(visit.type);
  const current = picked.step ?? visit.currentStep;
  const done = useMemo(() => new Set(doneSteps(visit.type, facts)), [visit.type, facts]);
  const view = picked.view ?? visit.viewMode;
  const index = steps.indexOf(current);

  // Where the visit opens next is a convenience: a failed save is not worth a message.
  const storeView = useCallback(
    (next: VisitViewMode) => {
      if (!canStore) return;
      new MutationObserver(queryClient, mutations.setView).mutate(next).catch(() => undefined);
    },
    [canStore, queryClient, mutations],
  );
  const storeStep = useCallback(
    (step: VisitStep) => {
      if (!canStore) return;
      new MutationObserver(queryClient, mutations.setStep).mutate(step).catch(() => undefined);
    },
    [canStore, queryClient, mutations],
  );

  const setView = useCallback(
    (next: VisitViewMode) => {
      setPicked((state) => ({ ...state, view: next }));
      storeView(next);
    },
    [storeView],
  );
  const goTo = useCallback(
    (step: VisitStep) => {
      setPicked({ step, view: 'steps' });
      storeStep(step);
      if (view !== 'steps') storeView('steps');
    },
    [storeStep, storeView, view],
  );

  return {
    type: visit.type,
    steps,
    current,
    done,
    view,
    previous: steps[index - 1] ?? null,
    next: steps[index + 1] ?? null,
    goTo,
    setView,
  };
}
