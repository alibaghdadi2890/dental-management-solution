import {
  ageOn,
  type ClinicalSummary,
  currentPresence,
  deriveChart,
  type DiagnosisRecord,
  effectiveDentition,
  type HistoryService,
  type LastVisit,
  type PatientChart,
  PERMANENT_CODES,
  type PlanGroup,
  PRIMARY_CODES,
  toothCodeSchema,
  type ToothCode,
  type ToothHistory,
  type ToothPresenceRecord,
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
import { PlanGroupsRepository } from '../persistence/plan-groups.repository';
import { PlanSessionsRepository } from '../persistence/plan-sessions.repository';
import { ToothPresenceRepository } from '../persistence/tooth-presence.repository';
import { TreatmentPlansRepository } from '../persistence/treatment-plans.repository';
import { VisitServicesRepository } from '../persistence/visit-services.repository';
import { VisitsRepository } from '../persistence/visits.repository';
import {
  toDiagnosisRecord,
  toHistoryService,
  toPlanGroup,
  toPresenceRecord,
  toTreatmentPlan,
} from './record-mapping';
import { toVisitService } from './visit-mapping';

/** A patient's presence rows, diagnoses, plans and finished services, with the dentists' names
 * resolved, and which of the patient's visits were voided (D6). */
interface Records {
  presence: ToothPresenceRecord[];
  diagnoses: DiagnosisRecord[];
  plans: TreatmentPlan[];
  history: HistoryService[];
  voidedVisitIds: string[];
}

/**
 * A patient's clinical record as the chart, the tooth history, the Last visit card and the
 * treatment summary read it (docs/modules/clinical.md, spec §ChartService). Everything needs
 * `visit:read` and runs in one `TenantDb` transaction; the patient comes from `PatientsService`,
 * so an unknown one (another tenant's included) is 404 `patient.not_found`. Records that were
 * removed never appear; history is the services of completed, amended and voided visits — a voided
 * visit's records and treatment stay as recorded and are marked through `voidedVisitIds` (4b, D6). A patient's records are
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
    private readonly groups: PlanGroupsRepository,
    private readonly sessions: PlanSessionsRepository,
    private readonly presences: ToothPresenceRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The whole chart: the dentition (the override, else the stage for the age on the tenant's
   * today, else permanent without a date of birth), the presence rows (missing, not erupted,
   * implant; feature 7), the records, the patient's most recent live visit and the derived
   * per-tooth state, which counts that visit's services as treated today.
   */
  chart(patientId: string): Promise<PatientChart> {
    return this.read(async () => {
      const patient = await this.patients.get(patientId);
      const { timeZone } = await this.tenancy.currentTenant();
      const today = localDate(this.clock.now(), timeZone);
      // A birth date on the tenant's tomorrow (allowed at entry) is a newborn.
      const ageYears =
        patient.dateOfBirth === null ? null : Math.max(0, ageOn(patient.dateOfBirth, today));
      const { voidedVisitIds, ...records } = await this.records(patient.id, timeZone);
      const planGroups: PlanGroup[] = (await this.groups.listForPatient(patient.id)).map(
        toPlanGroup,
      );
      const liveVisit = (await this.visits.liveRefs({ patientId: patient.id })).at(-1);
      const liveServices = liveVisit
        ? (await this.services.listForVisit(liveVisit.id)).map((service) =>
            toVisitService(service, liveVisit.currency),
          )
        : [];
      return {
        dentition: { ...effectiveDentition(ageYears, patient.dentitionOverride), ageYears },
        ...records,
        planGroups,
        liveVisitId: liveVisit?.id ?? null,
        voidedVisitIds,
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
      const { timeZone } = await this.tenancy.currentTenant();
      const { presence, diagnoses, plans, history, voidedVisitIds } = await this.records(
        patient.id,
        timeZone,
        toothCode,
      );
      return { toothCode, presence, diagnoses, plans, services: history, voidedVisitIds };
    });
  }

  /**
   * The most recently completed visit, amended or not (the Last visit card, D18), or null: its local date, dentist,
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
          jaw: service.jaw,
        })),
        notes: visit.notes,
      };
    });
  }

  /**
   * The Record overview's treatment counts (W8), with the missing teeth and implants among the
   * teeth of the chart the patient is on (feature 7, D8): an adult's long-gone primary molar is
   * not a missing tooth.
   */
  summary(patientId: string): Promise<ClinicalSummary> {
    return this.read(async () => {
      const patient = await this.patients.get(patientId);
      const { timeZone } = await this.tenancy.currentTenant();
      const today = localDate(this.clock.now(), timeZone);
      const ageYears =
        patient.dateOfBirth === null ? null : Math.max(0, ageOn(patient.dateOfBirth, today));
      const { stage } = effectiveDentition(ageYears, patient.dentitionOverride);
      const onChart: ReadonlySet<string> = new Set(
        stage === 'primary' ? PRIMARY_CODES : PERMANENT_CODES,
      );
      const states = [
        ...currentPresence(
          (await this.presences.listForPatient(patient.id)).map(({ row }) => ({
            toothCode: toothCodeSchema.parse(row.toothCode),
            presence: row.presence,
          })),
        ),
      ].filter(([code]) => onChart.has(code));
      const count = (presence: string) => states.filter(([, state]) => state === presence).length;
      return {
        ...(await this.visits.clinicalSummary(patient.id)),
        missingTeeth: count('missing'),
        implants: count('implant'),
      };
    });
  }

  private read<T>(work: () => Promise<T>): Promise<T> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(work);
  }

  /**
   * The patient's records (one tooth's when `toothCode` is given), dentist names included. A
   * diagnosis recorded without a visit is dated by `recordedAt` in the tenant's time zone.
   */
  private async records(
    patientId: string,
    timeZone: string,
    toothCode?: ToothCode,
  ): Promise<Records> {
    const diagnoses = await this.diagnoses.listForPatient(patientId, toothCode);
    const plans = await this.plans.listForPatient(patientId, toothCode);
    const history = await this.services.finishedForPatient(patientId, toothCode);
    const presence = await this.presences.listForPatient(patientId, toothCode);
    const names = await this.dentistNames([
      ...presence.map(({ row }) => row.dentistId),
      ...diagnoses.map(({ record }) => record.dentistId),
      ...plans.map((plan) => plan.dentistId),
      ...history.map((line) => line.dentistId),
    ]);
    const nameOf = (profileId: string) => names.get(profileId) ?? '';
    const sessions = await this.sessions.listForPlans(plans.map((plan) => plan.id));
    const sessionsOf = (planId: string) =>
      sessions
        .filter((session) => session.planId === planId)
        .map(({ visitId, date, note }) => ({ visitId, date, note }));
    return {
      presence: presence.map((line) => toPresenceRecord(line, nameOf(line.row.dentistId))),
      diagnoses: diagnoses.map(({ record, visitDate }) =>
        toDiagnosisRecord(
          record,
          visitDate ?? localDate(record.recordedAt, timeZone),
          nameOf(record.dentistId),
        ),
      ),
      plans: plans.map((plan) =>
        toTreatmentPlan(plan, nameOf(plan.dentistId), sessionsOf(plan.id)),
      ),
      history: history.map((line) => toHistoryService(line, nameOf(line.dentistId))),
      voidedVisitIds: await this.visits.voidedIdsForPatient(patientId),
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
