import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { PatientsModule } from '../patients';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { CatalogSeedingSubscriber } from './application/catalog-seeding.subscriber';
import { CatalogService } from './application/catalog.service';
import { VisitsService } from './application/visits.service';
import { CatalogController } from './http/catalog.controller';
import { VisitsController } from './http/visits.controller';
import { DiagnosesRepository } from './persistence/diagnoses.repository';
import { ProceduresRepository } from './persistence/procedures.repository';
import { VisitServicesRepository } from './persistence/visit-services.repository';
import { VisitsRepository } from './persistence/visits.repository';

/**
 * See docs/modules/clinical.md. The service and diagnosis catalogs (feature 2) and the visit
 * lifecycle (feature 4a). Depends on `patients` (existence, the dependent-write lock, names),
 * `users` (branch dentists, dentist names) and `tenancy` (currency, time zone, rooms); none of
 * them imports `clinical`.
 */
@Module({
  imports: [AuditModule, PatientsModule, TenancyModule, UsersModule],
  controllers: [CatalogController, VisitsController],
  providers: [
    CatalogService,
    CatalogSeedingSubscriber,
    ProceduresRepository,
    DiagnosesRepository,
    VisitsService,
    VisitsRepository,
    VisitServicesRepository,
  ],
  exports: [CatalogService, VisitsService],
})
export class ClinicalModule {}
