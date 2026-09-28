import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { ContactLinks } from './application/contact-links';
import { ContactsService } from './application/contacts.service';
import { PatientsService } from './application/patients.service';
import { ContactsController } from './http/contacts.controller';
import { PatientsController } from './http/patients.controller';
import { ContactsRepository } from './persistence/contacts.repository';
import { PatientContactsRepository } from './persistence/patient-contacts.repository';
import { PatientCountersRepository } from './persistence/patient-counters.repository';
import { PatientsRepository } from './persistence/patients.repository';

/** See docs/modules/patients.md. Depends on `tenancy` (country, time zone) and `users` (ADR-0016). */
@Module({
  imports: [AuditModule, TenancyModule, UsersModule],
  controllers: [PatientsController, ContactsController],
  providers: [
    PatientsService,
    ContactsService,
    ContactLinks,
    PatientsRepository,
    PatientCountersRepository,
    ContactsRepository,
    PatientContactsRepository,
  ],
  exports: [PatientsService, ContactsService],
})
export class PatientsModule {}
