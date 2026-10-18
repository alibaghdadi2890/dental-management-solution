import type {
  ContactRelationship,
  DentitionStage,
  EntryVisitType,
  PatientSex,
} from '@dcm/contracts';
import type { StoredMedicalHistory } from './medical-history';

/**
 * The domain shape of a patient row: mirrors the contract `Patient` plus two internal fields the
 * repository writes and never returns over HTTP (`nameKey`, `phoneSearch` — CLAUDE.md §4, §5).
 * Timestamps stay `Date` here, the same boundary the rest of the codebase uses (e.g. `users`'
 * `StaffProfile`): the repository maps rows to this type, and the application service converts to
 * ISO strings when it builds the contract response. `dateOfBirth` is a plain ISO date string
 * (`YYYY-MM-DD`, no time, no zone) since the column is a `date`.
 */
export interface DomainPatient extends StoredMedicalHistory {
  id: string;
  displayNumber: string;
  fullName: string;
  /** Normalized form of `fullName` for diacritics-insensitive search (`domain/name-key.ts`). */
  nameKey: string;
  /** E.164, or the text as typed when not a valid number; null without one (ADR-0052). */
  phone: string | null;
  /** The phone's search digits (`storedPhone`); null without a phone. */
  phoneSearch: string | null;
  dateOfBirth: string | null;
  sex: PatientSex;
  email: string | null;
  address: string | null;
  insurance: string | null;
  notes: string | null;
  /** What a new patient came for (feature 10); read only to suggest their first visit's type. */
  firstVisitType: EntryVisitType | null;
  /** `staff_profiles.id` (ADR-0020). */
  primaryDentistId: string | null;
  /** Null means "auto": the chart derives the stage from age (spec W14). */
  dentitionOverride: DentitionStage | null;
  externalId: string | null;
  mergedIntoId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A list item's primary guardian, resolved through a linked patient (design addendum C7). */
export interface GuardianSummary {
  contactId: string;
  fullName: string;
  phone: string | null;
  relationship: ContactRelationship;
}

/** The contact through whose phone a search `q` matched a patient (addendum C7). */
export interface MatchedContactSummary {
  fullName: string;
  relationship: ContactRelationship;
}

/** A patient as the list, palette and duplicate views read it. */
export interface DomainPatientListRow extends DomainPatient {
  primaryGuardian: GuardianSummary | null;
  /** Set only by a search whose `q` matched this patient through a contact's phone alone. */
  matchedContact: MatchedContactSummary | null;
}
