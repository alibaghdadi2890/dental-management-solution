import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { TenancyModule } from '../tenancy';
import { CatalogSeedingSubscriber } from './application/catalog-seeding.subscriber';
import { CatalogService } from './application/catalog.service';
import { CatalogController } from './http/catalog.controller';
import { DiagnosesRepository } from './persistence/diagnoses.repository';
import { ProceduresRepository } from './persistence/procedures.repository';

/** See docs/modules/clinical.md. So far: the service and diagnosis catalogs (feature 2). */
@Module({
  imports: [AuditModule, TenancyModule],
  controllers: [CatalogController],
  providers: [CatalogService, CatalogSeedingSubscriber, ProceduresRepository, DiagnosesRepository],
  exports: [CatalogService],
})
export class ClinicalModule {}
