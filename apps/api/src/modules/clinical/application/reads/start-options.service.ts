import { type StartOptions, suggestVisitType } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../../platform/cls/request-context';
import { TenantDb } from '../../../../platform/db/tenant-db';
import { PatientsService } from '../../../patients';
import { TreatmentPlansRepository } from '../../persistence/treatment-plans.repository';
import { VisitsRepository } from '../../persistence/visits.repository';

/**
 * What the Start visit popover needs about a patient (feature 10, V1; docs/modules/clinical.md):
 * the type it suggests.
 */
@Injectable()
export class StartOptionsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly patients: PatientsService,
    private readonly visits: VisitsRepository,
    private readonly plans: TreatmentPlansRepository,
  ) {}

  /**
   * `suggestedType` (`suggestVisitType`): Treatment while the patient has open plans, else what
   * a patient without a visit yet was registered for, else an examination. Needs `visit:write`;
   * unknown patient → 404.
   */
  async forPatient(patientId: string): Promise<StartOptions> {
    this.context.requirePermission('visit:write');
    return this.tenantDb.run(async () => {
      const patient = await this.patients.get(patientId);
      const open = await this.plans.listOpenForPatient(patient.id);
      return {
        suggestedType: suggestVisitType({
          openPlans: open.length,
          countedVisits: await this.visits.countedCount(patient.id),
          firstVisitType: patient.firstVisitType,
        }),
      };
    });
  }
}
