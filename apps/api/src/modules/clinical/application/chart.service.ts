import {
  ageOn,
  type ClinicalSummary,
  deriveChart,
  type DiagnosisRecord,
  effectiveDentition,
  type HistoryService,
  type LastVisit,
  type PatientChart,
  successionPositionSchema,
  toothCodeSchema,
  type ToothCode,
  type ToothHistory,
  type TreatmentPlan,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate } from '../../../platform/kernel/local-date';
import { PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { UsersService } from '../../users';
import { PatientDiagnosesRepository } from '../persistence/patient-diagnoses.repository';
import { ToothStatusRepository } from '../persistence/tooth-status.repository';
import { TreatmentPlansRepository } from '../persistence/treatment-plans.repository';
import { VisitServicesRepository } from '../persistence/visit-services.repository';
import { VisitsRepository } from '../persistence/visits.repository';
import { toDiagnosisRecord, toHistoryService, toTreatmentPlan } from './record-mapping';
import { toVisitService } from './visit-mapping';

/** A patient's diagnoses, plans and completed services, with the dentists' names resolved. */
interface Records {
  diagnoses: DiagnosisRecord[];
  plans: TreatmentPlan[];
  history: HistoryService[];
}

/**
 * A patient's clinical record as the chart, the tooth history, the Last visit card and the
 * treatment summary read it (docs/modules/clinical.md, spec §ChartService). Everything needs
 * `visit:read` and runs in one `TenantDb` transaction; the patient comes from `PatientsService`,
 * so an unknown one (another tenant's included) is 404 `patient.not_found`. Records that were
 * removed never appear; history is the services of completed visits. A patient's records are
 * bounded (hundreds), so nothing is paginated. Dentist names come from one
 * `practitionersByProfileIds` call per read.
 */
@Injectable()
export class ChartService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly tenancy: TenancyService,
    private readonly patients: PatientsService,
    private readonly users: UsersService,
    private readonly visits: VisitsRepository,
    private readonly services: VisitServicesRepository,
    private readonly diagnoses: PatientDiagnosesRepository,
    private readonly plans: TreatmentPlansRepository,
    private readonly teeth: ToothStatusRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The whole chart: the dentition (the override, else the stage for the age on the tenant's
   * today, else permanent without a date of birth), the per-position tooth presence, the
   * records, the patient's most recent live visit and the derived per-tooth state, which counts
   * that visit's services as treated today.
   */
  chart(patientId: string): Promise<PatientChart> {
    return this.read(async () => {
      const patient = await this.patients.get(patientId);
      const { timeZone } = await this.tenancy.currentTenant();
      const today = localDate(this.clock.now(), timeZone);
      // A birth date on the tenant's tomorrow (allowed at entry) is a newborn.
      const ageYears =
        patient.dateOfBirth === null ? null : Math.max(0, ageOn(patient.dateOfBirth, today));
      const records = await this.records(patient.id);
      const liveVisit = (await this.visits.liveRefs({ patientId: patient.id })).at(-1);
      const liveServices = liveVisit
        ? (await this.services.listForVisit(liveVisit.id)).map((service) =>
            toVisitService(service, liveVisit.currency),
          )
        : [];
      return {
        dentition: { ...effectiveDentition(ageYears, patient.dentitionOverride), ageYears },
        toothStatus: (await this.teeth.listForPatient(patient.id)).map((row) => ({
          // The table's CHECK admits exactly the succession positions.
          position: successionPositionSchema.parse(row.position),
          present: row.present,
        })),
        ...records,
        liveVisitId: liveVisit?.id ?? null,
        teeth: [...deriveChart({ ...records, liveServices }).values()],
      };
    });
  }

  /**
   * One tooth's three stages, in order (the Tooth History modal): its diagnoses and plans as
   * recorded, then its completed services, most recent first. Only records on this very code;
   * the modal links the predecessor or successor itself.
   */
  toothHistory(patientId: string, toothCode: ToothCode): Promise<ToothHistory> {
    return this.read(async () => {
      const patient = await this.patients.get(patientId);
      const { diagnoses, plans, history } = await this.records(patient.id, toothCode);
      return { toothCode, diagnoses, plans, services: history };
    });
  }

  /**
   * The most recently completed visit (the Last visit card), or null: its local date, dentist,
   * duration, frozen total and the services that weren't removed, as chips.
   */
  lastVisit(patientId: string): Promise<LastVisit> {
    return this.read(async () => {
      const patient = await this.patients.get(patientId);
      const visit = await this.visits.latestCompleted(patient.id);
      if (!visit) return null;
      const { durationMinutes, total } = visit;
      // `visits_completed_fields`: a completed visit has its duration and money.
      if (durationMinutes === null || total === null) {
        throw new Error(`completed visit ${visit.id} has no duration or total`);
      }
      const services = await this.services.listForVisit(visit.id);
      const names = await this.dentistNames([visit.dentistId]);
      return {
        id: visit.id,
        date: visit.localDate,
        dentistName: names.get(visit.dentistId) ?? '',
        durationMinutes,
        total: { amount: total, currency: visit.currency },
        services: services.map((service) => ({
          name: service.name,
          toothCode: service.toothCode === null ? null : toothCodeSchema.parse(service.toothCode),
        })),
        notes: visit.notes,
      };
    });
  }

  /** The Record overview's treatment counts (W8). */
  summary(patientId: string): Promise<ClinicalSummary> {
    return this.read(async () => {
      const patient = await this.patients.get(patientId);
      return this.visits.clinicalSummary(patient.id);
    });
  }

  private read<T>(work: () => Promise<T>): Promise<T> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(work);
  }

  /** The patient's records (one tooth's when `toothCode` is given), dentist names included. */
  private async records(patientId: string, toothCode?: ToothCode): Promise<Records> {
    const diagnoses = await this.diagnoses.listForPatient(patientId, toothCode);
    const plans = await this.plans.listForPatient(patientId, toothCode);
    const history = await this.services.completedForPatient(patientId, toothCode);
    const names = await this.dentistNames([
      ...diagnoses.map(({ record }) => record.dentistId),
      ...plans.map((plan) => plan.dentistId),
      ...history.map((line) => line.dentistId),
    ]);
    const nameOf = (profileId: string) => names.get(profileId) ?? '';
    return {
      diagnoses: diagnoses.map(({ record, recordedInVisitDate }) =>
        toDiagnosisRecord(record, recordedInVisitDate, nameOf(record.dentistId)),
      ),
      plans: plans.map((plan) => toTreatmentPlan(plan, nameOf(plan.dentistId))),
      history: history.map((line) => toHistoryService(line, nameOf(line.dentistId))),
    };
  }

  /** Staff profile id → display name, in one call (ADR-0020; former staff included). */
  private async dentistNames(profileIds: string[]): Promise<Map<string, string>> {
    if (profileIds.length === 0) return new Map();
    return new Map(
      (await this.users.practitionersByProfileIds(profileIds)).map((practitioner) => [
        practitioner.id,
        practitioner.displayName,
      ]),
    );
  }
}
