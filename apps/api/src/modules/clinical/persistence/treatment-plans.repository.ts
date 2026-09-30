import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { RecordNotFoundError } from '../domain/visit-errors';
import { treatmentPlans } from './schema';

type PlanRow = typeof treatmentPlans.$inferSelect;

/** A `treatment_plans` row as the application sees it (RLS supplies the tenant). */
export type StoredTreatmentPlan = Omit<PlanRow, 'tenantId'>;

export type NewTreatmentPlan = Pick<
  StoredTreatmentPlan,
  | 'patientId'
  | 'toothCode'
  | 'surfaces'
  | 'procedureId'
  | 'code'
  | 'name'
  | 'category'
  | 'chargeUnit'
  | 'priceAmount'
  | 'priceCurrency'
  | 'diagnosisRecordId'
  | 'note'
  | 'dentistId'
  | 'recordedBy'
  | 'recordedInVisitId'
  | 'recordedAt'
>;

/** Perform (and its undo), cancel or the soft delete; each status pair is set or cleared together. */
export type TreatmentPlanPatch = Partial<
  Pick<
    StoredTreatmentPlan,
    | 'status'
    | 'performedInVisitId'
    | 'performedAt'
    | 'cancelledInVisitId'
    | 'cancelledAt'
    | 'deletedAt'
  >
>;

function toStored({ tenantId: _tenantId, ...plan }: PlanRow): StoredTreatmentPlan {
  return plan;
}

/**
 * Planned procedures of the tenant's patients (RLS through `TenantDb`). Every lookup names the
 * patient too: a visit reaches only its own patient's plans, and the queries use the
 * `(tenant_id, patient_id, tooth_code)` index.
 */
@Injectable()
export class TreatmentPlansRepository {
  constructor(private readonly db: TenantDb) {}

  async insert(plan: NewTreatmentPlan): Promise<StoredTreatmentPlan> {
    const [row] = await this.db.run((tx) => tx.insert(treatmentPlans).values(plan).returning());
    if (!row) throw new Error('treatment plan insert returned no row');
    return toStored(row);
  }

  /** The patient's plan (not removed) `FOR UPDATE`; else 404 `record.not_found`. */
  lockForPatient(id: string, patientId: string): Promise<StoredTreatmentPlan> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(treatmentPlans)
        .where(
          and(
            eq(treatmentPlans.id, id),
            eq(treatmentPlans.patientId, patientId),
            isNull(treatmentPlans.deletedAt),
          ),
        )
        .for('update');
      if (!row) throw new RecordNotFoundError('Plan not found for this patient');
      return toStored(row);
    });
  }

  async update(id: string, patch: TreatmentPlanPatch): Promise<StoredTreatmentPlan> {
    const [row] = await this.db.run((tx) =>
      tx.update(treatmentPlans).set(patch).where(eq(treatmentPlans.id, id)).returning(),
    );
    if (!row) throw new RecordNotFoundError('Plan not found');
    return toStored(row);
  }

  /**
   * Clears the link from the patient's plans to a diagnosis record being removed (removed plans
   * included, so none points at it); returns the ids of the plans that were linked.
   */
  async unlinkDiagnosis(patientId: string, diagnosisRecordId: string): Promise<string[]> {
    const rows = await this.db.run((tx) =>
      tx
        .update(treatmentPlans)
        .set({ diagnosisRecordId: null })
        .where(
          and(
            eq(treatmentPlans.patientId, patientId),
            eq(treatmentPlans.diagnosisRecordId, diagnosisRecordId),
          ),
        )
        .returning({ id: treatmentPlans.id }),
    );
    return rows.map((row) => row.id);
  }
}
