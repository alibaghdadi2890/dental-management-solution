import type { Patient, PatientListItem } from '@dcm/contracts';
import type { DomainPatient } from '../domain/patient';

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
    medicalAlerts: patient.medicalAlerts,
    primaryDentistId: patient.primaryDentistId,
    notes: patient.notes,
    externalId: patient.externalId,
    archivedAt: patient.deletedAt?.toISOString() ?? null,
    mergedIntoId: patient.mergedIntoId,
    createdAt: patient.createdAt.toISOString(),
    updatedAt: patient.updatedAt.toISOString(),
  };
}

/** The list/palette columns. */
export function toListItem(patient: DomainPatient): PatientListItem {
  return {
    id: patient.id,
    displayNumber: patient.displayNumber,
    fullName: patient.fullName,
    phone: patient.phone,
    dateOfBirth: patient.dateOfBirth,
    sex: patient.sex,
    medicalAlerts: patient.medicalAlerts,
    primaryDentistId: patient.primaryDentistId,
    email: patient.email,
    archivedAt: patient.deletedAt?.toISOString() ?? null,
    updatedAt: patient.updatedAt.toISOString(),
  };
}
