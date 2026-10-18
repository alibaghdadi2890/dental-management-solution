import {
  type ContactLinkInput,
  type ContactLinkTarget,
  type ContactRelationship,
  decimalAmountSchema,
  emailSchema,
  EMPTY_MEDICAL_HISTORY,
  type EntryVisitType,
  isMinor,
  isoDateSchema,
  type MedicalHistoryInput,
  nameSchema,
  storedPhone,
  openingBalanceInputSchema,
  PATIENT_CREATE_CONTACTS_MAX,
  patientCreateSchema,
  patientPatchSchema,
  type OpeningBalanceInput,
  type Patient,
  type PatientCreate,
  type PatientCreateInput,
  type PatientPatch,
  type PatientSex,
  toMedicalHistoryInput,
} from '@dcm/contracts';
import { parseAmount } from '@/lib/amount';
import { formatPhone } from '@/lib/format';
import { sameHistory } from './medical-history/history-model';

/**
 * The pure create/edit patient form model (design "Create / Edit" panel and the Patient
 * information tab, which share this exact model). Every field is a plain string so a controlled
 * `<input>` can bind to it directly — except what is picked, not typed: the medical history's
 * chips and the create-only contacts (`pendingContacts`, `linkContactId`); conversion to/from the wire types (`Patient`,
 * `PatientCreate`, `PatientPatch`) happens only at the edges (`fromPatient`, `toCreatePayload`,
 * `toPatchPayload`).
 */
export interface PatientFormValues {
  fullName: string;
  /** Optional, any format: stored as typed when it is not a valid number (ADR-0052). */
  phone: string;
  /** ISO `YYYY-MM-DD`, or `''` for not set — an `<input type="date">`'s own empty value. */
  dateOfBirth: string;
  sex: PatientSex;
  email: string;
  address: string;
  insurance: string;
  /** Allergies, conditions and medication (feature 10): the chips' own model, sent whole. */
  medicalHistory: MedicalHistoryInput;
  /** Create-only: what the patient comes for (the First visit tiles), or `''` for not said. */
  firstVisitType: EntryVisitType | '';
  /**
   * A practitioner's staff profile id (`Practitioner.id`, ADR-0020), or `''` for none (a native
   * `<select>`'s empty option).
   */
  primaryDentistId: string;
  notes: string;
  /** Create-only "Account" group (design Q1); ignored once a patient already exists. */
  openingBalanceAmount: string;
  openingBalanceAsOf: string;
  openingBalanceNote: string;
  /**
   * Create-only: the contacts linked in the create's transaction (design addendum C4). Once the
   * patient exists, contact changes are immediate actions (`contacts-api.ts`), never form state.
   */
  pendingContacts: PendingContact[];
  /** Create-only: an unlinked contact who becomes this patient ("Link to {name}"), or `''`. */
  linkContactId: string;
}

/** How a picked contact reads in the form before it exists as a link (the picker's row). */
export interface ContactDisplay {
  fullName: string;
  /** E.164, or null for a contact linked to a patient recorded without a phone (a minor). */
  phone: string | null;
  /** The "Patient P-000042" badge: the display number of the patient this contact is. */
  patientNumber: string | null;
  /** That patient is archived. */
  archived: boolean;
}

/** A contact to link on create: the `ContactLinkInput` sent, plus how it reads meanwhile. */
export interface PendingContact {
  /** Stable while the form is open (a list key), never sent. */
  key: string;
  link: ContactLinkInput;
  display: ContactDisplay;
}

export interface PatientFormPrefill {
  fullName?: string;
  phone?: string;
}

const EMPTY: PatientFormValues = {
  fullName: '',
  phone: '',
  dateOfBirth: '',
  sex: 'unknown',
  email: '',
  address: '',
  insurance: '',
  medicalHistory: toMedicalHistoryInput(EMPTY_MEDICAL_HISTORY),
  firstVisitType: '',
  primaryDentistId: '',
  notes: '',
  openingBalanceAmount: '',
  openingBalanceAsOf: '',
  openingBalanceNote: '',
  pendingContacts: [],
  linkContactId: '',
};

/** A blank create form, optionally pre-filled (⌘K "Create '{query}'": digits → phone, else name). */
export function emptyForm(prefill: PatientFormPrefill = {}): PatientFormValues {
  return { ...EMPTY, fullName: prefill.fullName ?? '', phone: prefill.phone ?? '' };
}

/** The edit form / Patient information tab's starting values for an existing patient. The Account
 * group is always blank here: an opening balance is create-only (design Q1, Q12). `country` shows
 * the phone the way the tenant types/reads it (`formatPhone`) rather than the stored E.164 form. */
export function fromPatient(patient: Patient, country: string): PatientFormValues {
  return {
    ...EMPTY,
    fullName: patient.fullName,
    phone: patient.phone ? formatPhone(patient.phone, country) : '',
    dateOfBirth: patient.dateOfBirth ?? '',
    sex: patient.sex,
    email: patient.email ?? '',
    address: patient.address ?? '',
    insurance: patient.insurance ?? '',
    medicalHistory: toMedicalHistoryInput(patient.medicalHistory),
    primaryDentistId: patient.primaryDentistId ?? '',
    notes: patient.notes ?? '',
  };
}

export type FormField =
  | 'fullName'
  | 'phone'
  | 'dateOfBirth'
  | 'email'
  | 'address'
  | 'insurance'
  | 'notes'
  | 'openingBalanceAmount'
  | 'openingBalanceAsOf'
  | 'openingBalanceNote'
  | 'linkContactId'
  | ContactErrorField;

/** A pending contact's error, by its index in `pendingContacts` (the create's `contacts.<i>`). */
export type ContactErrorField = `contacts.${number}`;

export function contactErrorField(index: number): ContactErrorField {
  return `contacts.${String(index)}` as ContactErrorField;
}

/** i18n keys, not messages — the panel looks these up in its own namespace. */
export type FormErrorKey =
  | 'roleRequired'
  | 'invalid'
  | 'required'
  | 'invalidEmail'
  | 'invalidDate'
  | 'futureDate'
  | 'beforeMinDate'
  | 'tooLong'
  | 'invalidAmount'
  | 'negativeAmount';

export type FormErrors = Partial<Record<FormField, FormErrorKey>>;

/** Mirrors `patients.ts`'s private `DATE_OF_BIRTH_FLOOR`, which the contract doesn't export (it's
 * folded into `dateOfBirthSchema`'s `.refine()`). Duplicated rather than widening that schema's
 * export surface for one constant; a drift here would only make the client warn a moment before
 * the server's own check rejects the same date. Also the date picker's first selectable day. */
export const DATE_OF_BIRTH_FLOOR = '1900-01-01';

/** A country as `storedPhone` (`@dcm/contracts`) wants it; kept as `string` at this module's
 * boundary so `apps/web` doesn't need its own `libphonenumber-js` dependency just for the type. */
type PhoneCountry = Parameters<typeof storedPhone>[1];

/** The contract's limit on a typed phone (`optionalText(40)`). */
const PHONE_MAX = 40;

const OPENING_BALANCE_NOTE_MAX = 200;

/** Only the `FormField`s that are also plain string properties of `PatientFormValues` with a
 * simple, always-applicable max-length rule — the `openingBalance…` fields (checked only while
 * a balance will be recorded) have their own dedicated checks in `validate`. Keyed to
 * this narrower type (not `FormField`) so `values[field]` below can't be asked for a field that
 * doesn't exist. */
type TextLimitField = 'address' | 'insurance' | 'notes';

const TEXT_FIELD_MAX: Record<TextLimitField, number> = {
  address: 240,
  insurance: 120,
  notes: 2000,
};

export interface ValidateContext {
  /** Today in the tenant's own timezone (`todayIn`), never the browser's. */
  today: string;
}

/** A valid date of birth, not after `today` (the tenant's), under 18 on `today`; `''` or `null`
 * (no date of birth) is an adult. An unset, half-typed or future date is never a minor's:
 * `isMinor`'s age arithmetic goes negative for a future date. */
export function minorOn(dateOfBirth: string | null, today: string): boolean {
  return (
    dateOfBirth !== null &&
    isoDateSchema.safeParse(dateOfBirth).success &&
    dateOfBirth <= today &&
    isMinor(dateOfBirth, today)
  );
}

/** The create panel's Guardian block (design addendum "Create panel"): shown while the date of
 * birth makes the patient a minor on the tenant's `today`; adults get the optional "Contacts &
 * family" disclosure instead. */
export function showGuardianBlock(values: PatientFormValues, today: string): boolean {
  return minorOn(values.dateOfBirth, today);
}

/** A guardian added from the Guardian block: always the guardian, and — the two toggles, on by
 * default — the billing and the emergency contact too. */
export function guardianLink(
  target: ContactLinkTarget,
  relationship: ContactRelationship,
  { billing = true, emergency = true }: { billing?: boolean; emergency?: boolean } = {},
): ContactLinkInput {
  return {
    target,
    relationship,
    isGuardian: true,
    isBillingContact: billing,
    isEmergencyContact: emergency,
  };
}

/** Who a target names, when it names someone who already exists (`contact:<id>`,
 * `patient:<id>`); a new contact names nobody yet. */
function targetKey(target: ContactLinkTarget): string | undefined {
  if ('contactId' in target) return `contact:${target.contactId}`;
  if ('patientId' in target) return `patient:${target.patientId}`;
  return undefined;
}

/** A random v4 UUID for a pending contact's list key. `crypto.randomUUID` exists only in a secure
 * context (HTTPS or localhost): on a plain-HTTP address (a clinic's own LAN server) the key is made
 * from `crypto.getRandomValues`, which every context has. */
function pendingKey(): string {
  const { randomUUID } = crypto as Partial<Crypto>;
  if (randomUUID) return randomUUID.call(crypto);
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/**
 * Adds a contact to link on create. Unchanged (the same object) when it would be refused anyway:
 * the create already links 10, the contact or patient is already pending, or it is the contact
 * this patient becomes (`linkContactId`: a patient is never their own contact).
 */
export function addPendingContact(
  values: PatientFormValues,
  link: ContactLinkInput,
  display: ContactDisplay,
): PatientFormValues {
  if (values.pendingContacts.length >= PATIENT_CREATE_CONTACTS_MAX) return values;
  const key = targetKey(link.target);
  if (key !== undefined) {
    if (values.pendingContacts.some((pending) => targetKey(pending.link.target) === key)) {
      return values;
    }
    if (key === `contact:${values.linkContactId}`) return values;
  }
  const pending: PendingContact = { key: pendingKey(), link, display };
  return { ...values, pendingContacts: [...values.pendingContacts, pending] };
}

/** Changes a pending link's relationship or roles (its target stays). */
export function updatePendingContact(
  values: PatientFormValues,
  key: string,
  patch: Partial<Omit<ContactLinkInput, 'target'>>,
): PatientFormValues {
  return {
    ...values,
    pendingContacts: values.pendingContacts.map((pending) =>
      pending.key === key ? { ...pending, link: { ...pending.link, ...patch } } : pending,
    ),
  };
}

export function removePendingContact(values: PatientFormValues, key: string): PatientFormValues {
  return {
    ...values,
    pendingContacts: values.pendingContacts.filter((pending) => pending.key !== key),
  };
}

/** Sets (or, with `null`, clears) the unlinked contact this patient becomes; a pending link to
 * that same contact is dropped, since a patient is never their own contact. */
export function setLinkContactId(
  values: PatientFormValues,
  contactId: string | null,
): PatientFormValues {
  if (contactId === null) return { ...values, linkContactId: '' };
  return {
    ...values,
    linkContactId: contactId,
    pendingContacts: values.pendingContacts.filter(
      (pending) => targetKey(pending.link.target) !== `contact:${contactId}`,
    ),
  };
}

/** The contacts and patients already pending — and the contact this patient becomes — for the
 * picker to leave out. */
export function pendingExclusions(values: PatientFormValues): {
  contactIds: string[];
  patientIds: string[];
} {
  const contactIds: string[] = values.linkContactId === '' ? [] : [values.linkContactId];
  const patientIds: string[] = [];
  for (const { link } of values.pendingContacts) {
    if ('contactId' in link.target) contactIds.push(link.target.contactId);
    else if ('patientId' in link.target) patientIds.push(link.target.patientId);
  }
  return { contactIds, patientIds };
}

/** `.5` → `0.5`, `5.` → `5`: the two shapes `Number()` parses fine but `decimalAmountSchema`'s
 * strict regex (and the amount input's own visual alignment) doesn't want. Locale/digit
 * normalisation itself lives in `amountValue`/`lib/amount.ts`; this only tidies the dot. */
function normalizeAmountText(text: string): string {
  let result = text;
  if (result.startsWith('.')) result = `0${result}`;
  if (result.endsWith('.')) result = result.slice(0, -1);
  return result;
}

/** Field-level validation, keyed by i18n error code rather than message text (CLAUDE.md §13).
 * Covers every field the payload builders (`toCreatePayload`/`toPatchPayload`/`toOpeningBalance`)
 * actually parse, so that whenever this returns `{}` those builders never throw. */
export function validate(values: PatientFormValues, { today }: ValidateContext): FormErrors {
  const errors: FormErrors = {};

  if (values.fullName.trim() === '') {
    errors.fullName = 'required';
  } else if (!nameSchema.safeParse(values.fullName).success) {
    errors.fullName = 'tooLong';
  }

  if (values.phone.trim().length > PHONE_MAX) errors.phone = 'tooLong';

  if (values.dateOfBirth !== '') {
    if (!isoDateSchema.safeParse(values.dateOfBirth).success) {
      errors.dateOfBirth = 'invalidDate';
    } else if (values.dateOfBirth > today) {
      errors.dateOfBirth = 'futureDate';
    } else if (values.dateOfBirth < DATE_OF_BIRTH_FLOOR) {
      errors.dateOfBirth = 'beforeMinDate';
    }
  }

  if (values.email.trim() !== '' && !emailSchema.safeParse(values.email).success) {
    errors.email = 'invalidEmail';
  }

  for (const [field, max] of Object.entries(TEXT_FIELD_MAX) as [TextLimitField, number][]) {
    if (!errors[field] && values[field].trim().length > max) {
      errors[field] = 'tooLong';
    }
  }

  if (values.openingBalanceAmount.trim() !== '') {
    const amount = normalizeAmountText(values.openingBalanceAmount);
    if (!decimalAmountSchema.safeParse(amount).success) {
      errors.openingBalanceAmount = 'invalidAmount';
    } else if (Number(amount) < 0) {
      // Zero is valid and means no opening balance: `wantsOpeningBalance` then creates through
      // `POST /patients` and no ledger entry is written.
      errors.openingBalanceAmount = 'negativeAmount';
    }
  }

  // As of and Note belong to a recorded balance: without an amount above zero nothing is
  // recorded, the panel disables them, and they are not sent — so there is nothing to check.
  if (wantsOpeningBalance(values)) {
    if (values.openingBalanceAsOf.trim() !== '') {
      if (!isoDateSchema.safeParse(values.openingBalanceAsOf).success) {
        errors.openingBalanceAsOf = 'invalidDate';
      } else if (values.openingBalanceAsOf > today) {
        errors.openingBalanceAsOf = 'futureDate';
      }
    }
    if (values.openingBalanceNote.trim().length > OPENING_BALANCE_NOTE_MAX) {
      errors.openingBalanceNote = 'tooLong';
    }
  }

  values.pendingContacts.forEach(({ link }, index) => {
    const error = contactLinkError(link);
    if (error) errors[contactErrorField(index)] = error;
  });

  return errors;
}

/** What `patientCreateSchema` would refuse in one pending link: no role, or a new contact whose
 * name or phone does not hold (the picker checks both before adding it; this keeps
 * `toCreatePayload` from ever throwing on a link added some other way). */
function contactLinkError(link: ContactLinkInput): FormErrorKey | undefined {
  if (!link.isGuardian && !link.isBillingContact && !link.isEmergencyContact) {
    return 'roleRequired';
  }
  if (!('newContact' in link.target)) return undefined;
  const { fullName, phone } = link.target.newContact;
  if (!nameSchema.safeParse(fullName).success) return 'invalid';
  if (phone.trim() === '' || phone.trim().length > PHONE_MAX) return 'invalid';
  return undefined;
}

/** True when any field differs from the form's starting values, trimmed (the create panel's
 * "Unsaved" badge — it has no patch to compare against, and cares about the Account fields
 * (`openingBalance…`) a patch never touches, so it uses this simpler field-by-field check rather
 * than `isEditDirty`). */
export function isDirty(initial: PatientFormValues, current: PatientFormValues): boolean {
  // A create form starts with no pending contacts, so any pending one is a change.
  if (current.pendingContacts.length > 0) return true;
  if (!sameHistory(initial.medicalHistory, current.medicalHistory)) return true;
  return (Object.keys(initial) as (keyof PatientFormValues)[]).some((key) => {
    if (key === 'pendingContacts' || key === 'medicalHistory') return false;
    return initial[key].trim() !== current[key].trim();
  });
}

/** The opening-balance amount's form value for what was typed (design "Account" group): a plain
 * decimal when the text is a clean number for `locale` (`'12,50'` in French → `'12.50'`), else
 * the text as typed, which `validate` then reports as `invalidAmount` — `12.505` or `12abc` is
 * never quietly trimmed into another amount. */
export function amountValue(text: string, locale: string): string {
  return parseAmount(text, locale) ?? text.trim();
}

/** Whether to call `POST /billing/opening-balances` instead of `POST /patients` (design Q1: "the
 * SPA uses it only when an amount > 0 is entered"). */
export function wantsOpeningBalance(values: PatientFormValues): boolean {
  return Number(normalizeAmountText(values.openingBalanceAmount) || '0') > 0;
}

/** The create payload; a blank phone is sent as `null` (any patient may have none, ADR-0052). The
 * pending contacts go as `contacts` (their `ContactLinkInput`s, in order: a server error at
 * `contacts.<i>` is the i-th pending contact), and `linkContactId` only once set. */
export function toCreatePayload(values: PatientFormValues): PatientCreate {
  const input: PatientCreateInput = {
    fullName: values.fullName,
    phone: values.phone,
    dateOfBirth: values.dateOfBirth || null,
    sex: values.sex,
    email: values.email,
    address: values.address,
    insurance: values.insurance,
    medicalHistory: values.medicalHistory,
    firstVisitType: values.firstVisitType || null,
    primaryDentistId: values.primaryDentistId || null,
    notes: values.notes,
    contacts: values.pendingContacts.map((pending) => pending.link),
    ...(values.linkContactId === '' ? {} : { linkContactId: values.linkContactId }),
  };
  return patientCreateSchema.parse(input);
}

const PATCHABLE_TEXT_FIELDS = [
  'fullName',
  'phone',
  'dateOfBirth',
  'email',
  'address',
  'insurance',
  'notes',
] as const;

function normalizedPhoneOf(text: string, country: string): string {
  return storedPhone(text, country as PhoneCountry)?.value ?? '';
}

/** Compares each patchable field the way it should be compared for "did this actually change":
 * phone as stored (re-typing a valid number in a different format isn't a change),
 * email case/whitespace-insensitively (the server lowercases it anyway), everything else trimmed. */
function normalizedFieldValue(
  field: (typeof PATCHABLE_TEXT_FIELDS)[number],
  value: string,
  country: string,
): string {
  if (field === 'phone') return normalizedPhoneOf(value, country);
  if (field === 'email') return value.trim().toLowerCase();
  return value.trim();
}

/** The changed fields as raw form text, not yet parsed — `toPatchPayload`'s core, shared with
 * `isEditDirty`, which must answer while a field still holds a half-typed (invalid) value. A
 * cleared phone is sent as `''`, which the patch schema turns into `null`. */
function changedFields(
  initial: PatientFormValues,
  current: PatientFormValues,
  country: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  for (const field of PATCHABLE_TEXT_FIELDS) {
    const changed =
      normalizedFieldValue(field, initial[field], country) !==
      normalizedFieldValue(field, current[field], country);
    if (changed) {
      patch[field] = field === 'dateOfBirth' ? current[field] || null : current[field].trim();
    }
  }

  if (initial.sex !== current.sex) {
    patch.sex = current.sex;
  }

  if (initial.primaryDentistId !== current.primaryDentistId) {
    patch.primaryDentistId = current.primaryDentistId || null;
  }

  if (!sameHistory(initial.medicalHistory, current.medicalHistory)) {
    patch.medicalHistory = current.medicalHistory;
  }

  return patch;
}

/**
 * Only the fields that actually changed since `initial`, normalised as `normalizedFieldValue`
 * describes — `null` (not run through `patientPatchSchema`, which requires at least one key) when
 * nothing did. `sex` has no "unset" state to compare against blank, so it's included whenever it
 * differs like any other field. Throws on an invalid value, like the create builders: call it
 * only once `validate` returns `{}`.
 */
export function toPatchPayload(
  initial: PatientFormValues,
  current: PatientFormValues,
  country: string,
): PatientPatch | null {
  const patch = changedFields(initial, current, country);
  if (Object.keys(patch).length === 0) return null;
  return patientPatchSchema.parse(patch);
}

/** Edit-mode "Unsaved changes" check (design Q16): whether saving would actually send a patch,
 * using `toPatchPayload`'s own normalised comparison (phone by parsed E.164, email case/
 * whitespace-insensitively, everything else trimmed) — so re-typing the same phone number in a
 * different format never shows "Unsaved". Never throws: a half-typed value is a change, not an
 * error. */
export function isEditDirty(
  initial: PatientFormValues,
  current: PatientFormValues,
  country: string,
): boolean {
  return Object.keys(changedFields(initial, current, country)).length > 0;
}

/** `POST /billing/opening-balances`'s `openingBalance` leg; only call once `wantsOpeningBalance`
 * is true — an amount of `0` fails `openingBalanceInputSchema`'s "must be greater than zero". The
 * amount is run through `normalizeAmountText` first so a `.5`/`5.` that reached form state some
 * way other than `amountValue` (e.g. a pre-filled draft) still parses. */
export function toOpeningBalance(values: PatientFormValues, today: string): OpeningBalanceInput {
  return openingBalanceInputSchema.parse({
    amount: normalizeAmountText(values.openingBalanceAmount) || '0',
    asOf: values.openingBalanceAsOf || today,
    note: values.openingBalanceNote,
  });
}
