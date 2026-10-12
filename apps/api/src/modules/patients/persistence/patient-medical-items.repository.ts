import type { MedicalItem } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { medicalHistoryOptions, patientMedicalItems } from './schema';

/** A patient's allergies and conditions, each list by name. */
export interface PatientMedicalItems {
  allergies: MedicalItem[];
  conditions: MedicalItem[];
}

/**
 * The allergies and conditions patients have (`patient_medical_items`, RLS through `TenantDb`).
 * An item's name is its option's current name, so a renamed option reads renamed everywhere.
 */
@Injectable()
export class PatientMedicalItemsRepository {
  constructor(private readonly db: TenantDb) {}

  /** The items of each patient among `patientIds`; a patient without any is absent. */
  async forPatients(patientIds: readonly string[]): Promise<Map<string, PatientMedicalItems>> {
    const byPatient = new Map<string, PatientMedicalItems>();
    if (patientIds.length === 0) return byPatient;
    const rows = await this.db.run((tx) =>
      tx
        .select({
          patientId: patientMedicalItems.patientId,
          id: medicalHistoryOptions.id,
          kind: medicalHistoryOptions.kind,
          name: medicalHistoryOptions.name,
        })
        .from(patientMedicalItems)
        .innerJoin(
          medicalHistoryOptions,
          eq(medicalHistoryOptions.id, patientMedicalItems.optionId),
        )
        .where(inArray(patientMedicalItems.patientId, [...new Set(patientIds)]))
        .orderBy(asc(sql`lower(${medicalHistoryOptions.name})`), asc(medicalHistoryOptions.id)),
    );
    for (const { patientId, id, kind, name } of rows) {
      const items = byPatient.get(patientId) ?? { allergies: [], conditions: [] };
      items[kind === 'allergy' ? 'allergies' : 'conditions'].push({ id, name });
      byPatient.set(patientId, items);
    }
    return byPatient;
  }

  /** Makes `optionIds` the patient's items, of both lists: the rest are removed. */
  async replace(patientId: string, optionIds: readonly string[]): Promise<void> {
    await this.db.run(async (tx) => {
      await tx.delete(patientMedicalItems).where(eq(patientMedicalItems.patientId, patientId));
      if (optionIds.length === 0) return;
      await tx
        .insert(patientMedicalItems)
        .values([...new Set(optionIds)].map((optionId) => ({ patientId, optionId })));
    });
  }
}
