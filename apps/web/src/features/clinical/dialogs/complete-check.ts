import type { Jaw, PatientChart, ToothCode, Visit } from '@dcm/contracts';
import { sessionNumberIn } from '../flow/visit-facts';
import { workedIn } from '../workspace/unfinished';
import { type DiagnosisToResolve, diagnosesToResolve } from './diagnoses-to-resolve';

/** What the dentist says of a piece of today's work before Complete (ADR-0065). */
export type WorkChoice = 'finished' | 'continues';

/**
 * Work this visit did whose end is still to say: work in progress it worked on (a plan), or a
 * service added by hand without a plan. `key` is unique across both kinds.
 */
export interface WorkToFinish {
  key: string;
  kind: 'plan' | 'service';
  /** The plan's id, or the service's. */
  id: string;
  name: string;
  toothCode: ToothCode | null;
  jaw: Jaw | null;
  /** A plan's: which of its sessions this visit is, and how many it was estimated to take. */
  session: number | null;
  estimatedSessions: number | null;
  /** The diagnosis a plan treats. */
  diagnosisRecordId: string | null;
  /** What the switch starts on. */
  suggested: WorkChoice;
}

/**
 * The work to ask about, in the order Today's services lists it: the services added by hand,
 * then the work in progress this visit worked on. A plan is Finished on its last estimated
 * session and Continues otherwise, an estimate or not (most work takes several visits); a service
 * is Finished. What the visit's type added, and work completed already, are not asked about.
 */
export function workToFinish(visit: Visit, chart: PatientChart): WorkToFinish[] {
  const services = visit.services
    .filter((service) => service.planId === null && !service.autoAdded)
    .map((service): WorkToFinish => ({
      key: `service:${service.id}`,
      kind: 'service',
      id: service.id,
      name: service.name,
      toothCode: service.toothCode,
      jaw: service.jaw,
      session: null,
      estimatedSessions: null,
      diagnosisRecordId: null,
      suggested: 'finished',
    }));
  const plans = chart.plans
    .filter((plan) => plan.status === 'in_progress' && workedIn(plan, visit.id))
    .map((plan): WorkToFinish => {
      const session = sessionNumberIn(plan, visit.id);
      const last = plan.estimatedSessions !== null && session >= plan.estimatedSessions;
      return {
        key: `plan:${plan.id}`,
        kind: 'plan',
        id: plan.id,
        name: plan.name,
        toothCode: plan.toothCode,
        jaw: plan.jaw,
        session,
        estimatedSessions: plan.estimatedSessions,
        diagnosisRecordId: plan.diagnosisRecordId,
        suggested: last ? 'finished' : 'continues',
      };
    });
  return [...services, ...plans];
}

export type WorkChoices = ReadonlyMap<string, WorkChoice>;

export const choiceOf = (item: WorkToFinish, choices: WorkChoices): WorkChoice =>
  choices.get(item.key) ?? item.suggested;

/** What applying the check does: plans to complete, services to mark not finished, diagnoses to
 * resolve, in that order. */
export interface CheckDecisions {
  finish: string[];
  unfinish: string[];
  resolve: string[];
}

export interface CompleteCheck {
  work: WorkToFinish[];
  diagnoses: DiagnosisToResolve[];
  /** The diagnoses ticked unless the dentist unticks them: those a Finished plan treats. */
  suggested: ReadonlySet<string>;
}

/**
 * The check before Complete (ADR-0065): the work to ask about and the diagnoses still open on the
 * visit as `choices` would leave it — Finished plans performed here, services that Continue no
 * longer done work. `shown` holds what an earlier check of this page listed (work keys and
 * diagnosis ids): it is not asked about again, and its work counts as it now stands.
 */
export function completeCheck(
  visit: Visit,
  chart: PatientChart,
  choices: WorkChoices = new Map(),
  shown: ReadonlySet<string> = new Set(),
): CompleteCheck {
  const work = workToFinish(visit, chart).filter((item) => !shown.has(item.key));
  const finished = new Set(
    work
      .filter((item) => item.kind === 'plan' && choiceOf(item, choices) === 'finished')
      .map((item) => item.id),
  );
  const continuing = new Set(
    work
      .filter((item) => item.kind === 'service' && choiceOf(item, choices) === 'continues')
      .map((item) => item.id),
  );
  const projectedVisit: Visit = {
    ...visit,
    services: visit.services.filter((service) => !continuing.has(service.id)),
  };
  const projectedChart: PatientChart = {
    ...chart,
    plans: chart.plans.map((plan) =>
      finished.has(plan.id)
        ? { ...plan, status: 'performed' as const, performedInVisitId: visit.id }
        : plan,
    ),
  };
  return {
    work,
    diagnoses: diagnosesToResolve(projectedVisit, projectedChart).filter(
      (item) => !shown.has(item.record.id),
    ),
    suggested: new Set(
      work.flatMap((item) =>
        item.diagnosisRecordId !== null && finished.has(item.id) ? [item.diagnosisRecordId] : [],
      ),
    ),
  };
}

/** Whether the check has anything to ask. */
export const hasQuestions = (check: CompleteCheck) =>
  check.work.length > 0 || check.diagnoses.length > 0;

/** What the check's answers come to: only what changes something. */
export function checkDecisions(
  check: CompleteCheck,
  choices: WorkChoices,
  ticked: (recordId: string) => boolean,
): CheckDecisions {
  return {
    finish: check.work
      .filter((item) => item.kind === 'plan' && choiceOf(item, choices) === 'finished')
      .map((item) => item.id),
    unfinish: check.work
      .filter((item) => item.kind === 'service' && choiceOf(item, choices) === 'continues')
      .map((item) => item.id),
    resolve: check.diagnoses.map((item) => item.record.id).filter(ticked),
  };
}

/** Everything a check listed: not asked about again on this page. */
export const shownBy = (check: CompleteCheck): string[] => [
  ...check.work.map((item) => item.key),
  ...check.diagnoses.map((item) => item.record.id),
];
