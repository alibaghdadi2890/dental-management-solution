import type {
  DiagnosisRecord,
  HistoryService,
  PatientChart,
  SurfaceKey,
  ToothCode,
  TreatmentPlan,
} from '@dcm/contracts';

export type StepKind = 'diagnosed' | 'planned' | 'performed' | 'cancelled' | 'resolved';

/** One dated step of a thread, and the visit it happened in. */
export interface ThreadStep {
  kind: StepKind;
  /** An ISO date or timestamp. */
  at: string;
  visitId: string;
  /** The step's visit was voided (D6): it stays, struck through. */
  voided: boolean;
  /** The plan's name, on plan steps. */
  name?: string | undefined;
}

/**
 * One problem and what was done about it (4b, D15, the Clinical view): a diagnosis with the plans
 * made for it (`diagnosisRecordId`), or a plan made without one. `open` threads need attention —
 * an active diagnosis, or a plan still planned; `needsPlan` flags an active diagnosis with no plan
 * that is planned or performed.
 */
export interface Thread {
  id: string;
  toothCode: ToothCode | null;
  surfaces: SurfaceKey[];
  title: string;
  dentistName: string;
  diagnosis: DiagnosisRecord | null;
  plans: TreatmentPlan[];
  steps: ThreadStep[];
  open: boolean;
  needsPlan: boolean;
}

/** Services performed without a plan, by tooth (`null` = jaw-level), most recent first. */
export interface UnplannedGroup {
  toothCode: ToothCode | null;
  services: HistoryService[];
}

export interface Threads {
  needsAttention: Thread[];
  completed: Thread[];
  unplanned: UnplannedGroup[];
}

const byTooth = (a: ToothCode | null, b: ToothCode | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b);

function planSteps(plan: TreatmentPlan, voided: (id: string) => boolean): ThreadStep[] {
  const steps: ThreadStep[] = [
    {
      kind: 'planned',
      at: plan.recordedAt,
      visitId: plan.recordedInVisitId,
      voided: voided(plan.recordedInVisitId),
      name: plan.name,
    },
  ];
  if (plan.performedInVisitId !== null && plan.performedAt !== null) {
    steps.push({
      kind: 'performed',
      at: plan.performedAt,
      visitId: plan.performedInVisitId,
      voided: voided(plan.performedInVisitId),
      name: plan.name,
    });
  }
  if (plan.cancelledInVisitId !== null && plan.cancelledAt !== null) {
    steps.push({
      kind: 'cancelled',
      at: plan.cancelledAt,
      visitId: plan.cancelledInVisitId,
      voided: voided(plan.cancelledInVisitId),
      name: plan.name,
    });
  }
  return steps;
}

const latest = (thread: Thread) =>
  thread.steps.reduce((max, step) => (step.at > max ? step.at : max), '');

/**
 * The Clinical view's threads from the patient's chart (no extra request): each diagnosis with
 * its plans, then the plans made without a diagnosis, then the services performed without a plan
 * by tooth. Steps are in time order; threads by tooth, then most recent activity first.
 */
export function buildThreads(chart: PatientChart): Threads {
  const voidedIds = new Set(chart.voidedVisitIds);
  const voided = (id: string) => voidedIds.has(id);
  const diagnosisIds = new Set(chart.diagnoses.map((record) => record.id));
  const threads: Thread[] = [];

  for (const diagnosis of chart.diagnoses) {
    const plans = chart.plans.filter((plan) => plan.diagnosisRecordId === diagnosis.id);
    const steps: ThreadStep[] = [
      {
        kind: 'diagnosed',
        at: diagnosis.recordedInVisitDate,
        visitId: diagnosis.recordedInVisitId,
        voided: voided(diagnosis.recordedInVisitId),
      },
      ...plans.flatMap((plan) => planSteps(plan, voided)),
    ];
    if (diagnosis.resolvedInVisitId !== null && diagnosis.resolvedAt !== null) {
      steps.push({
        kind: 'resolved',
        at: diagnosis.resolvedAt,
        visitId: diagnosis.resolvedInVisitId,
        voided: voided(diagnosis.resolvedInVisitId),
      });
    }
    const active = diagnosis.status === 'active';
    threads.push({
      id: diagnosis.id,
      toothCode: diagnosis.toothCode,
      surfaces: diagnosis.surfaces,
      title: diagnosis.name,
      dentistName: diagnosis.dentistName,
      diagnosis,
      plans,
      steps: steps.sort((a, b) => a.at.localeCompare(b.at)),
      open: active || plans.some((plan) => plan.status === 'planned'),
      needsPlan: active && !plans.some((plan) => plan.status !== 'cancelled'),
    });
  }

  for (const plan of chart.plans) {
    if (plan.diagnosisRecordId !== null && diagnosisIds.has(plan.diagnosisRecordId)) continue;
    threads.push({
      id: plan.id,
      toothCode: plan.toothCode,
      surfaces: plan.surfaces,
      title: plan.name,
      dentistName: plan.dentistName,
      diagnosis: null,
      plans: [plan],
      steps: planSteps(plan, voided),
      open: plan.status === 'planned',
      needsPlan: false,
    });
  }

  threads.sort((a, b) => byTooth(a.toothCode, b.toothCode) || latest(b).localeCompare(latest(a)));

  const groups = new Map<ToothCode | null, HistoryService[]>();
  for (const service of chart.history) {
    if (service.planId !== null) continue;
    groups.set(service.toothCode, [...(groups.get(service.toothCode) ?? []), service]);
  }

  return {
    needsAttention: threads.filter((thread) => thread.open),
    completed: threads.filter((thread) => !thread.open),
    unplanned: [...groups.entries()]
      .sort(([a], [b]) => byTooth(a, b))
      .map(([toothCode, services]) => ({ toothCode, services })),
  };
}

export type ThreadFilter = 'active' | 'planned' | 'resolved';

/** The status chips: an active diagnosis, a plan still planned, a resolved diagnosis. */
export function matchesFilter(thread: Thread, filter: ThreadFilter): boolean {
  if (filter === 'active') return thread.diagnosis?.status === 'active';
  if (filter === 'planned') return thread.plans.some((plan) => plan.status === 'planned');
  return thread.diagnosis?.status === 'resolved';
}
