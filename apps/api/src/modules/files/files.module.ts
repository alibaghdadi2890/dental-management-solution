import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { ClinicalModule } from '../clinical';
import { PatientsModule } from '../patients';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { FilesService } from './application/files.service';
import { MergeFilesSubscriber } from './application/merge-files.subscriber';
import { FilesController } from './http/files.controller';
import { FilesRepository } from './persistence/files.repository';

/**
 * See docs/modules/files.md and ADR-0038 to ADR-0040. Depends on `patients` (the patient a file
 * belongs to), `clinical` (the visit it may be linked to), `users` (uploader names), `tenancy`
 * (the time zone "taken on" is read in) and `audit`; none of them imports `files`. Consumes
 * `PatientsMerged` in the merge transaction. Object storage comes from the global `StorageModule`.
 */
@Module({
  imports: [AuditModule, ClinicalModule, PatientsModule, TenancyModule, UsersModule],
  controllers: [FilesController],
  providers: [FilesService, FilesRepository, MergeFilesSubscriber],
  exports: [FilesService],
})
export class FilesModule {}
