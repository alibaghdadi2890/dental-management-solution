import { Injectable } from '@nestjs/common';
import { localDate } from '../../../../platform/kernel/local-date';
import { TenancyService } from '../../../tenancy';
import { UsersService } from '../../../users';
import type { StoredDiagnosisRecord } from '../../persistence/patient-diagnoses.repository';
import { PlanSessionsRepository } from '../../persistence/plan-sessions.repository';
import type { StoredToothPresence } from '../../persistence/tooth-presence.repository';
import type { StoredTreatmentPlan } from '../../persistence/treatment-plans.repository';
import { VisitServicesRepository } from '../../persistence/visit-services.repository';
import type { StoredVisit } from '../../persistence/visits.repository';
import { toDiagnosisRecord, toPresenceRecord, toTreatmentPlan } from './record-mapping';

/** One record as the API answers it after a charting change, with its dentist's name. */
@Injectable()
export class RecordPresenter {
  constructor(
    private readonly users: UsersService,
    private readonly tenancy: TenancyService,
    private readonly sessions: PlanSessionsRepository,
    private readonly services: VisitServicesRepository,
  ) {}

  /** `visitDate` is the recording visit's local date; a record made without a visit (ADR-0031) is
   * dated by `recordedAt` in the tenant's time zone. */
  async diagnosis(record: StoredDiagnosisRecord, visitDate: string | null) {
    const recordedDate =
      visitDate ?? localDate(record.recordedAt, (await this.tenancy.currentTenant()).timeZone);
    return toDiagnosisRecord(record, recordedDate, await this.dentistName(record.dentistId));
  }

  async plan(plan: StoredTreatmentPlan) {
    const sessions = (await this.sessions.listForPlans([plan.id])).map(
      ({ visitId, date, note }) => ({ visitId, date, note }),
    );
    const [charge] = await this.services.chargesFor([plan.id]);
    return toTreatmentPlan(plan, await this.dentistName(plan.dentistId), sessions, charge);
  }

  /** A presence row of this visit (no service: it was set by hand). */
  async presence(row: StoredToothPresence, visit: StoredVisit) {
    return toPresenceRecord(
      { row, visitNumber: visit.displayNumber, serviceCode: null, serviceName: null },
      await this.dentistName(row.dentistId),
    );
  }

  private async dentistName(profileId: string): Promise<string> {
    const [dentist] = await this.users.practitionersByProfileIds([profileId]);
    return dentist?.displayName ?? '';
  }
}
