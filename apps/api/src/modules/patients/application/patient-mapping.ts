import type { MedicalHistory, Patient, PatientListItem } from '@dcm/contracts';
import type { StoredMedicalHistory } from '../domain/medical-history';
import type { DomainPatient, DomainPatientListRow } from '../domain/patient';

/** The history as the API answers it: the items with their current names. */
function toMedicalHistory(history: StoredMedicalHistory): MedicalHistory {
  return {
    noKnownAllergies: history.noKnownAllergies,
    allergies: history.allergies,
    noConditions: history.noConditions,
    conditions: history.conditions,
    medication: history.medication,
  };
}

/** The contract record: ISO timestamps, `archivedAt` from `deleted_at`, no internal columns. */
export function toPatient(patient: DomainPatient): Patient {
  return {
    id: patient.id,
    displayNumber: patient.displayNumber,
    fullName: patient.fullName,
    phone: patient.phone,
    dateOfBirth: patient.dateOfBirth,
    sex: patient.sex,
    email: patient.email,
    address: patient.address,
    insurance: patient.insurance,
    medicalHistory: toMedicalHistory(patient),
    firstVisitType: patient.firstVisitType,
    primaryDentistId: patient.primaryDentistId,
    notes: patient.notes,
    dentitionOverride: patient.dentitionOverride,
    externalId: patient.externalId,
    archivedAt: patient.deletedAt?.toISOString() ?? null,
    mergedIntoId: patient.mergedIntoId,
    createdAt: patient.createdAt.toISOString(),
    updatedAt: patient.updatedAt.toISOString(),
  };
}

/** The list/palette columns, with the resolved primary guardian and the matched contact (C7). */
export function toListItem(patient: DomainPatientListRow): PatientListItem {
  return {
    id: patient.id,
    displayNumber: patient.displayNumber,
    fullName: patient.fullName,
    phone: patient.phone,
    dateOfBirth: patient.dateOfBirth,
    sex: patient.sex,
    allergyNames: patient.allergies.map((item) => item.name),
    conditionNames: patient.conditions.map((item) => item.name),
    primaryDentistId: patient.primaryDentistId,
    email: patient.email,
    archivedAt: patient.deletedAt?.toISOString() ?? null,
    updatedAt: patient.updatedAt.toISOString(),
    primaryGuardian: patient.primaryGuardian,
    matchedContact: patient.matchedContact,
  };
}
