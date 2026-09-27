import type { PatientSex } from '@dcm/contracts';

/**
 * The domain shape of a patient row: mirrors the contract `Patient` plus two internal fields the
 * repository writes and never returns over HTTP (`nameKey`, `phoneSearch` — CLAUDE.md §4, §5).
 * Timestamps stay `Date` here, the same boundary the rest of the codebase uses (e.g. `users`'
 * `StaffProfile`): the repository maps rows to this type, and the application service converts to
 * ISO strings when it builds the contract response. `dateOfBirth` is a plain ISO date string
 * (`YYYY-MM-DD`, no time, no zone) since the column is a `date`.
 */
export interface DomainPatient {
  id: string;
  displayNumber: string;
  fullName: string;
  /** Normalized form of `fullName` for diacritics-insensitive search (`domain/name-key.ts`). */
  nameKey: string;
  /** E.164, as stored. */
  phone: string;
  /** E.164 digits + national digits, space-separated, for phone search. */
  phoneSearch: string;
  dateOfBirth: string | null;
  sex: PatientSex;
  email: string | null;
  address: string | null;
  insurance: string | null;
  emergencyContact: string | null;
  notes: string | null;
  medicalAlerts: string[];
  primaryDentistUserId: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  externalId: string | null;
  mergedIntoId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
