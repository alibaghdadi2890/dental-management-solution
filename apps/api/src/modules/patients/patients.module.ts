import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { PatientsService } from './application/patients.service';
import { PatientsController } from './http/patients.controller';
import { PatientCountersRepository } from './persistence/patient-counters.repository';
import { PatientsRepository } from './persistence/patients.repository';

/** See docs/modules/patients.md. Depends on `tenancy` (country, time zone) and `users` (ADR-0016). */
@Module({
  imports: [AuditModule, TenancyModule, UsersModule],
  controllers: [PatientsController],
  providers: [PatientsService, PatientsRepository, PatientCountersRepository],
  exports: [PatientsService],
})
export class PatientsModule {}
