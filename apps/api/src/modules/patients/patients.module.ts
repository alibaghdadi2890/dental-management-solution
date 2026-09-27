import { Module } from '@nestjs/common';
import { PatientCountersRepository } from './persistence/patient-counters.repository';
import { PatientsRepository } from './persistence/patients.repository';

/**
 * See docs/modules/patients.md. So far: persistence only (feature 3 task B1). The repositories are
 * registered so integration tests can reach them directly; the application service, controller and
 * routes land in task B2.
 */
@Module({
  providers: [PatientsRepository, PatientCountersRepository],
})
export class PatientsModule {}
