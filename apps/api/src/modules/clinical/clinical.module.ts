import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { PatientsModule } from '../patients';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { CatalogSeedingSubscriber } from './application/catalog/catalog-seeding.subscriber';
import { CatalogService } from './application/catalog/catalog.service';
import { ChartService } from './application/reads/chart.service';
import { MergeClinicalSubscriber } from './application/merge-clinical.subscriber';
import { PatientRecordsService } from './application/records/patient-records.service';
import { PlanUnperformer } from './application/plan/plan-unperformer';
import { PresenceWriter } from './application/records/presence-writer';
import { RecordWriter } from './application/records/record-writer';
import { PlanChartingService } from './application/plan/plan-charting.service';
import { StartOptionsService } from './application/reads/start-options.service';
import { VisitListService } from './application/reads/visit-list.service';
import { DiagnosisChartingService } from './application/records/diagnosis-charting.service';
import { PresenceChartingService } from './application/records/presence-charting.service';
import { RecordPresenter } from './application/records/record-presenter';
import { ServiceChartingService } from './application/records/service-charting.service';
import { VisitCharting } from './application/records/visit-charting';
import { VisitCorrectionsService } from './application/visits/visit-corrections.service';
import { VisitFactsService } from './application/visits/visit-facts.service';
import { VisitFlowService } from './application/visits/visit-flow.service';
import { VisitLocks } from './application/visits/visit-locks';
import { VisitPresenter } from './application/visits/visit-presenter';
import { VisitImportService } from './application/visits/visit-import.service';
import { VisitsService } from './application/visits/visits.service';
import { CatalogController } from './http/catalog.controller';
import { ClinicalPatientsController } from './http/clinical-patients.controller';
import { PatientRecordsController } from './http/patient-records.controller';
import { VisitRecordsController } from './http/visit-records.controller';
import { VisitsController } from './http/visits.controller';
import { DiagnosesRepository } from './persistence/diagnoses.repository';
import { PatientDiagnosesRepository } from './persistence/patient-diagnoses.repository';
import { PlanSessionsRepository } from './persistence/plan-sessions.repository';
import { ProceduresRepository } from './persistence/procedures.repository';
import { ToothPresenceRepository } from './persistence/tooth-presence.repository';
import { TreatmentPlansRepository } from './persistence/treatment-plans.repository';
import { VisitAmendmentsRepository } from './persistence/visit-amendments.repository';
import { VisitCountersRepository } from './persistence/visit-counters.repository';
import { VisitPlanItemsRepository } from './persistence/visit-plan-items.repository';
import { VisitServicesRepository } from './persistence/visit-services.repository';
import { VisitsRepository } from './persistence/visits.repository';

/**
 * See docs/modules/clinical.md. The service and diagnosis catalogs (feature 2), and the visit
 * lifecycle, charting in a visit and the patient's chart reads (feature 4a), and charting on the
 * patient record outside a visit (ADR-0031). Depends on
 * `patients` (existence, the dependent-write lock, names, date of birth and dentition), `users`
 * (branch dentists, dentist names) and `tenancy` (currency, time zone, rooms); none of them
 * imports `clinical`. Re-points a merged patient's records inside the merge transaction.
 */
@Module({
  imports: [AuditModule, PatientsModule, TenancyModule, UsersModule],
  controllers: [
    CatalogController,
    VisitsController,
    VisitRecordsController,
    ClinicalPatientsController,
    PatientRecordsController,
  ],
  providers: [
    CatalogService,
    CatalogSeedingSubscriber,
    ProceduresRepository,
    DiagnosesRepository,
    VisitsService,
    VisitsRepository,
    VisitServicesRepository,
    VisitCorrectionsService,
    VisitImportService,
    VisitListService,
    VisitFactsService,
    VisitFlowService,
    StartOptionsService,
    VisitPlanItemsRepository,
    VisitLocks,
    VisitPresenter,
    VisitCharting,
    RecordPresenter,
    ServiceChartingService,
    DiagnosisChartingService,
    PresenceChartingService,
    PlanChartingService,
    PlanUnperformer,
    VisitCountersRepository,
    VisitAmendmentsRepository,
    PatientDiagnosesRepository,
    TreatmentPlansRepository,
    PlanSessionsRepository,
    ToothPresenceRepository,
    PresenceWriter,
    RecordWriter,
    PatientRecordsService,
    ChartService,
    MergeClinicalSubscriber,
  ],
  exports: [
    CatalogService,
    VisitsService,
    VisitImportService,
    VisitListService,
    VisitFactsService,
    PatientRecordsService,
    ChartService,
  ],
})
export class ClinicalModule {}
