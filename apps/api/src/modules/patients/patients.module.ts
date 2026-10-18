import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { ContactLinks } from './application/contact-links';
import { ContactsService } from './application/contacts.service';
import { MedicalOptionsSeedingSubscriber } from './application/medical-options-seeding.subscriber';
import { MedicalOptionsService } from './application/medical-options.service';
import { PatientsService } from './application/patients.service';
import { ContactsController } from './http/contacts.controller';
import { MedicalOptionsController } from './http/medical-options.controller';
import { PatientsController } from './http/patients.controller';
import { ContactsRepository } from './persistence/contacts.repository';
import { MedicalOptionsRepository } from './persistence/medical-options.repository';
import { PatientContactsRepository } from './persistence/patient-contacts.repository';
import { PatientCountersRepository } from './persistence/patient-counters.repository';
import { PatientMedicalItemsRepository } from './persistence/patient-medical-items.repository';
import { PatientsRepository } from './persistence/patients.repository';

/**
 * See docs/modules/patients.md. Depends on `tenancy` (country, time zone) and `users` (ADR-0016);
 * hears `TenantProvisioned` to seed the medical-history lists (event only, ADR-0014).
 */
@Module({
  imports: [AuditModule, TenancyModule, UsersModule],
  controllers: [PatientsController, ContactsController, MedicalOptionsController],
  providers: [
    PatientsService,
    ContactsService,
    MedicalOptionsService,
    MedicalOptionsSeedingSubscriber,
    ContactLinks,
    PatientsRepository,
    PatientMedicalItemsRepository,
    MedicalOptionsRepository,
    PatientCountersRepository,
    ContactsRepository,
    PatientContactsRepository,
  ],
  exports: [PatientsService, ContactsService, MedicalOptionsService],
})
export class PatientsModule {}
