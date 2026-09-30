import {
  type DiagnosisRecord,
  fromCents,
  type HistoryService,
  type Money,
  type PatientChart,
  toCents,
  type ToothCode,
  type TreatmentPlan,
  type Visit,
  type VisitService,
} from '@dcm/contracts';

/** Everything recorded on one tooth, for the panel's three stages and the succession row. */
export interface ToothRecords {
  diagnoses: DiagnosisRecord[];
  /** Every plan on the tooth, whatever its status. */
  plans: TreatmentPlan[];
  /** Services of completed visits, most recent first. */
  history: HistoryService[];
  /** This visit's services on the tooth. */
  services: VisitService[];
}

export function toothRecords(code: ToothCode, chart: PatientChart, visit: Visit): ToothRecords {
  return {
    diagnoses: chart.diagnoses.filter((record) => record.toothCode === code),
    plans: chart.plans.filter((plan) => plan.toothCode === code),
    history: chart.history.filter((line) => line.toothCode === code),
    services: visit.services.filter((line) => line.toothCode === code),
  };
}

/** The plans' total, in their (the tenant's) currency; `null` without plans. */
export function plansTotal(plans: readonly TreatmentPlan[]): Money | null {
  const [first] = plans;
  if (!first) return null;
  const cents = plans.reduce((sum, plan) => sum + toCents(plan.price.amount), 0n);
  return { amount: fromCents(cents), currency: first.price.currency };
}
