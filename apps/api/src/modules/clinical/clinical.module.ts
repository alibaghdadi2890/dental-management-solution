import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { PatientsModule } from '../patients';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { CatalogSeedingSubscriber } from './application/catalog-seeding.subscriber';
import { CatalogService } from './application/catalog.service';
import { ChartService } from './application/chart.service';
import { MergeClinicalSubscriber } from './application/merge-clinical.subscriber';
import { PatientRecordsService } from './application/patient-records.service';
import { PlanUnperformer } from './application/plan-unperformer';
import { PresenceWriter } from './application/presence-writer';
import { RecordWriter } from './application/record-writer';
import { VisitRecordsService } from './application/visit-records.service';
import { VisitsService } from './application/visits.service';
import { CatalogController } from './http/catalog.controller';
import { ClinicalPatientsController } from './http/clinical-patients.controller';
import { PatientRecordsController } from './http/patient-records.controller';
import { VisitRecordsController } from './http/visit-records.controller';
import { VisitsController } from './http/visits.controller';
import { DiagnosesRepository } from './persistence/diagnoses.repository';
import { PatientDiagnosesRepository } from './persistence/patient-diagnoses.repository';
import { PlanGroupsRepository } from './persistence/plan-groups.repository';
import { PlanSessionsRepository } from './persistence/plan-sessions.repository';
import { ProceduresRepository } from './persistence/procedures.repository';
import { ToothPresenceRepository } from './persistence/tooth-presence.repository';
import { TreatmentPlansRepository } from './persistence/treatment-plans.repository';
import { VisitAmendmentsRepository } from './persistence/visit-amendments.repository';
import { VisitCountersRepository } from './persistence/visit-counters.repository';
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
    VisitRecordsService,
    PlanUnperformer,
    VisitCountersRepository,
    VisitAmendmentsRepository,
    PatientDiagnosesRepository,
    TreatmentPlansRepository,
    PlanGroupsRepository,
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
    VisitRecordsService,
    PatientRecordsService,
    ChartService,
  ],
})
export class ClinicalModule {}
