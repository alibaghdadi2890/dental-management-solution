// Public API of the patients module. Other modules import from this file only (CLAUDE.md §4).
export { PatientsModule } from './patients.module';
export { type PatientSearchInternal, PatientsService } from './application/patients.service';
export { ContactsService } from './application/contacts.service';
export type { PatientRankKeys } from './domain/rank-keys';
export {
  MergeAlertsOverflowError,
  MergeSameError,
  PatientArchivedError,
  PatientMergedError,
  PatientNotFoundError,
  UnknownDentistError,
} from './domain/patient-errors';
export {
  ContactAlreadyLinkedError,
  ContactConflictError,
  ContactIsPatientError,
  ContactLinkedError,
  ContactNotFoundError,
  ContactPrimaryWithoutRoleError,
  ContactRoleRequiredError,
} from './domain/contact-errors';
export {
  PATIENT_ARCHIVED,
  PATIENT_CREATED,
  PATIENT_RESTORED,
  PATIENT_UPDATED,
  PATIENTS_MERGED,
  type PatientArchived,
  type PatientCreated,
  type PatientRestored,
  type PatientsMerged,
  type PatientUpdated,
} from './events/patient-events';
export {
  CONTACT_LINKED,
  CONTACT_UNLINKED,
  CONTACT_UPDATED,
  type ContactLinked,
  type ContactUnlinked,
  type ContactUpdated,
} from './events/contact-events';
