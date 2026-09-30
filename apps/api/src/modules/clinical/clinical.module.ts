import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { PatientsModule } from '../patients';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { CatalogSeedingSubscriber } from './application/catalog-seeding.subscriber';
import { CatalogService } from './application/catalog.service';
import { VisitRecordsService } from './application/visit-records.service';
import { VisitsService } from './application/visits.service';
import { CatalogController } from './http/catalog.controller';
import { VisitRecordsController } from './http/visit-records.controller';
import { VisitsController } from './http/visits.controller';
import { DiagnosesRepository } from './persistence/diagnoses.repository';
import { PatientDiagnosesRepository } from './persistence/patient-diagnoses.repository';
import { ProceduresRepository } from './persistence/procedures.repository';
import { ToothStatusRepository } from './persistence/tooth-status.repository';
import { TreatmentPlansRepository } from './persistence/treatment-plans.repository';
import { VisitServicesRepository } from './persistence/visit-services.repository';
import { VisitsRepository } from './persistence/visits.repository';

/**
 * See docs/modules/clinical.md. The service and diagnosis catalogs (feature 2) and the visit
 * lifecycle and charting in a visit (feature 4a). Depends on `patients` (existence, the dependent-write lock, names),
 * `users` (branch dentists, dentist names) and `tenancy` (currency, time zone, rooms); none of
 * them imports `clinical`.
 */
@Module({
  imports: [AuditModule, PatientsModule, TenancyModule, UsersModule],
  controllers: [CatalogController, VisitsController, VisitRecordsController],
  providers: [
    CatalogService,
    CatalogSeedingSubscriber,
    ProceduresRepository,
    DiagnosesRepository,
    VisitsService,
    VisitsRepository,
    VisitServicesRepository,
    VisitRecordsService,
    PatientDiagnosesRepository,
    TreatmentPlansRepository,
    ToothStatusRepository,
  ],
  exports: [CatalogService, VisitsService, VisitRecordsService],
})
export class ClinicalModule {}
