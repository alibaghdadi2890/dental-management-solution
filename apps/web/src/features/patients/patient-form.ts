import {
  decimalAmountSchema,
  dedupeAlerts,
  emailSchema,
  isMinor,
  isoDateSchema,
  MEDICAL_ALERTS_MAX,
  nameSchema,
  normalizePhone,
  openingBalanceInputSchema,
  patientInputSchema,
  patientPatchSchema,
  type OpeningBalanceInput,
  type Patient,
  type PatientInput,
  type PatientPatch,
  type PatientSex,
} from '@dcm/contracts';
import { sanitizeAmountInput } from '@/lib/amount';
import { formatPhone } from '@/lib/format';

/**
 * The pure create/edit patient form model (design "Create / Edit" panel and the Patient
 * information tab, which share this exact model). Every field is a plain string so a controlled
 * `<input>` can bind to it directly; conversion to/from the wire types (`Patient`, `PatientInput`,
 * `PatientPatch`) happens only at the edges (`fromPatient`, `toCreatePayload`, `toPatchPayload`).
 */
export interface PatientFormValues {
  fullName: string;
  phone: string;
  /** ISO `YYYY-MM-DD`, or `''` for not set — an `<input type="date">`'s own empty value. */
  dateOfBirth: string;
  sex: PatientSex;
  email: string;
  address: string;
  insurance: string;
  emergencyContact: string;
  /** Comma-separated, as typed; see `parseAlerts`. */
  alertsText: string;
  /** A practitioner's auth user id, or `''` for none (a native `<select>`'s empty option). */
  primaryDentistUserId: string;
  notes: string;
  guardianName: string;
  guardianPhone: string;
  /** Create-only "Account" group (design Q1); ignored once a patient already exists. */
  openingBalanceAmount: string;
  openingBalanceAsOf: string;
  openingBalanceNote: string;
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
  emergencyContact: '',
  alertsText: '',
  primaryDentistUserId: '',
  notes: '',
  guardianName: '',
  guardianPhone: '',
  openingBalanceAmount: '',
  openingBalanceAsOf: '',
  openingBalanceNote: '',
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
    phone: formatPhone(patient.phone, country),
    dateOfBirth: patient.dateOfBirth ?? '',
    sex: patient.sex,
    email: patient.email ?? '',
    address: patient.address ?? '',
    insurance: patient.insurance ?? '',
    emergencyContact: patient.emergencyContact ?? '',
    alertsText: patient.medicalAlerts.join(', '),
    primaryDentistUserId: patient.primaryDentistUserId ?? '',
    notes: patient.notes ?? '',
    guardianName: patient.guardianName ?? '',
    guardianPhone: patient.guardianPhone ? formatPhone(patient.guardianPhone, country) : '',
  };
}

export type FormField =
  | 'fullName'
  | 'phone'
  | 'dateOfBirth'
  | 'email'
  | 'address'
  | 'insurance'
  | 'emergencyContact'
  | 'notes'
  | 'guardianName'
  | 'guardianPhone'
  | 'alerts'
  | 'openingBalanceAmount'
  | 'openingBalanceAsOf'
  | 'openingBalanceNote';

/** i18n keys, not messages — the panel looks these up in its own namespace. */
export type FormErrorKey =
  | 'required'
  | 'invalidPhone'
  | 'invalidEmail'
  | 'invalidDate'
  | 'futureDate'
  | 'beforeMinDate'
  | 'tooLong'
  | 'tooMany'
  | 'invalidAmount'
  | 'notPositive';

export type FormErrors = Partial<Record<FormField, FormErrorKey>>;

/** Mirrors `patients.ts`'s private `DATE_OF_BIRTH_FLOOR`, which the contract doesn't export (it's
 * folded into `dateOfBirthSchema`'s `.refine()`). Duplicated rather than widening that schema's
 * export surface for one constant; a drift here would only make the client warn a moment before
 * the server's own check rejects the same date. */
const DATE_OF_BIRTH_FLOOR = '1900-01-01';

/** A country as `normalizePhone` (`@dcm/contracts`) wants it; kept as `string` at this module's
 * boundary so `apps/web` doesn't need its own `libphonenumber-js` dependency just for the type. */
type PhoneCountry = Parameters<typeof normalizePhone>[1];

const OPENING_BALANCE_NOTE_MAX = 200;
const GUARDIAN_NAME_MAX = 120;

/** Only the `FormField`s that are also plain string properties of `PatientFormValues` with a
 * simple, always-applicable max-length rule — `guardianName` has the same 120-char limit but is
 * checked separately (only while `showGuardian` is true; the hidden field is sent as `null`
 * regardless of what stale text it holds); `alerts`/`openingBalanceAmount`/`openingBalanceAsOf`
 * have their own dedicated checks in `validate`. Keyed to this narrower type (not `FormField`) so
 * `values[field]` below can't be asked for a field that doesn't exist. */
type TextLimitField = 'address' | 'insurance' | 'emergencyContact' | 'notes' | 'openingBalanceNote';

const TEXT_FIELD_MAX: Record<TextLimitField, number> = {
  address: 240,
  insurance: 120,
  emergencyContact: 160,
  notes: 2000,
  openingBalanceNote: OPENING_BALANCE_NOTE_MAX,
};

export interface ValidateContext {
  /** ISO 3166-1 alpha-2, e.g. the tenant's `country` (phones are parsed against it, design Q3). */
  country: string;
  /** Today in the tenant's own timezone (`todayIn`), never the browser's. */
  today: string;
}

/** True once a valid, not-in-the-future date of birth makes the patient under 18 on `today` — the
 * guardian fields' visibility rule (design "Create / Edit" panel). An unset, unparsed, or
 * future-dated DOB never shows it: `isMinor`'s age arithmetic goes negative for a future date,
 * which is not "a minor" by any reading. */
export function showGuardian(values: PatientFormValues, today: string): boolean {
  return (
    values.dateOfBirth !== '' && values.dateOfBirth <= today && isMinor(values.dateOfBirth, today)
  );
}

/** `'.5'` → `'.5'`, `'5.'` → `'5.'` (unchanged) — normalised separately by each caller that needs
 * a `Number()`-clean value; see `normalizeAmountText`. */
function rawAlertItems(text: string): string[] {
  return text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const ALERT_ITEM_MAX = 60;

/** `.5` → `0.5`, `5.` → `5`: the two shapes `Number()` parses fine but `decimalAmountSchema`'s
 * strict regex (and the amount input's own visual alignment) doesn't want. Locale/digit
 * normalisation itself lives in `sanitizeAmount`/`lib/amount.ts`; this only tidies the dot. */
function normalizeAmountText(text: string): string {
  let result = text;
  if (result.startsWith('.')) result = `0${result}`;
  if (result.endsWith('.')) result = result.slice(0, -1);
  return result;
}

/** Field-level validation, keyed by i18n error code rather than message text (CLAUDE.md §13).
 * Covers every field the payload builders (`toCreatePayload`/`toPatchPayload`/`toOpeningBalance`)
 * actually parse, so that whenever this returns `{}` those builders never throw. */
export function validate(
  values: PatientFormValues,
  { country, today }: ValidateContext,
): FormErrors {
  const errors: FormErrors = {};

  if (values.fullName.trim() === '') {
    errors.fullName = 'required';
  } else if (!nameSchema.safeParse(values.fullName).success) {
    errors.fullName = 'tooLong';
  }

  if (values.phone.trim() === '') {
    errors.phone = 'required';
  } else if (!normalizePhone(values.phone, country as PhoneCountry)) {
    errors.phone = 'invalidPhone';
  }

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

  // A hidden guardian is sent as `null` regardless of what its fields hold (`toCreatePayload`,
  // `toPatchPayload`'s `effectiveGuardian`), so there is nothing to validate while it's hidden.
  if (showGuardian(values, today)) {
    if (values.guardianName.trim().length > GUARDIAN_NAME_MAX) {
      errors.guardianName = 'tooLong';
    }
    if (
      values.guardianPhone.trim() !== '' &&
      !normalizePhone(values.guardianPhone, country as PhoneCountry)
    ) {
      errors.guardianPhone = 'invalidPhone';
    }
  }

  for (const [field, max] of Object.entries(TEXT_FIELD_MAX) as [TextLimitField, number][]) {
    if (!errors[field] && values[field].trim().length > max) {
      errors[field] = 'tooLong';
    }
  }

  const rawAlerts = rawAlertItems(values.alertsText);
  if (rawAlerts.some((alert) => alert.length > ALERT_ITEM_MAX)) {
    errors.alerts = 'tooLong';
  } else if (dedupeAlerts(rawAlerts).length > MEDICAL_ALERTS_MAX) {
    errors.alerts = 'tooMany';
  }

  if (values.openingBalanceAmount.trim() !== '') {
    const amount = normalizeAmountText(values.openingBalanceAmount);
    if (!decimalAmountSchema.safeParse(amount).success) {
      errors.openingBalanceAmount = 'invalidAmount';
    } else if (Number(amount) <= 0) {
      errors.openingBalanceAmount = 'notPositive';
    }
  }

  if (values.openingBalanceAsOf.trim() !== '') {
    if (!isoDateSchema.safeParse(values.openingBalanceAsOf).success) {
      errors.openingBalanceAsOf = 'invalidDate';
    } else if (values.openingBalanceAsOf > today) {
      errors.openingBalanceAsOf = 'futureDate';
    }
  }

  return errors;
}

/** True when any field differs from the form's starting values, trimmed (the create panel's
 * "Unsaved" badge — it has no patch to compare against, and cares about the Account fields
 * (`openingBalance…`) a patch never touches, so it uses this simpler field-by-field check rather
 * than `isEditDirty`). */
export function isDirty(initial: PatientFormValues, current: PatientFormValues): boolean {
  return (Object.keys(initial) as (keyof PatientFormValues)[]).some((key) => {
    const a = initial[key];
    const b = current[key];
    return a.trim() !== b.trim();
  });
}

/** Comma text → trimmed, de-duplicated, capped alerts (the chip input's model). */
export function parseAlerts(text: string): string[] {
  return dedupeAlerts(rawAlertItems(text)).slice(0, MEDICAL_ALERTS_MAX);
}

/** Keeps digits and a single dot, at most two decimal places, locale-aware (a French `,` decimal,
 * Arabic-Indic digits — see `lib/amount.ts`'s `sanitizeAmountInput`) — the opening-balance amount
 * input (design "Account" group). Unlike `catalog-draft.ts`'s `sanitizePrice`, a leading/trailing
 * dot is tidied immediately (`'.5'` → `'0.5'`, `'5.'` → `'5'`) rather than left for later: this
 * field's value is parsed by `decimalAmountSchema`, whose regex requires a leading digit and has
 * no meaning for a bare trailing dot. */
export function sanitizeAmount(value: string, locale: string): string {
  return normalizeAmountText(sanitizeAmountInput(value, locale));
}

/** Whether to call `POST /billing/opening-balances` instead of `POST /patients` (design Q1: "the
 * SPA uses it only when an amount > 0 is entered"). */
export function wantsOpeningBalance(values: PatientFormValues): boolean {
  return Number(normalizeAmountText(values.openingBalanceAmount) || '0') > 0;
}

/** The create payload; a guardian hidden by `showGuardian` is sent as `null` even if the fields
 * still hold text (e.g. the operator typed a DOB, filled the guardian in, then changed the DOB
 * back to an adult date) — the panel is the one place this rule needs enforcing, not the server. */
export function toCreatePayload(values: PatientFormValues, today: string): PatientInput {
  const guardianShown = showGuardian(values, today);
  return patientInputSchema.parse({
    fullName: values.fullName,
    phone: values.phone,
    dateOfBirth: values.dateOfBirth || null,
    sex: values.sex,
    email: values.email,
    address: values.address,
    insurance: values.insurance,
    emergencyContact: values.emergencyContact,
    medicalAlerts: parseAlerts(values.alertsText),
    primaryDentistUserId: values.primaryDentistUserId || null,
    notes: values.notes,
    guardianName: guardianShown ? values.guardianName : null,
    guardianPhone: guardianShown ? values.guardianPhone : null,
  });
}

const PATCHABLE_TEXT_FIELDS = [
  'fullName',
  'phone',
  'dateOfBirth',
  'email',
  'address',
  'insurance',
  'emergencyContact',
  'notes',
] as const;

/** The effective guardian text: cleared to `''` once `showGuardian` is false, so a patch compares
 * (and, when changed, sends) the value the record will actually end up with, not stale text left
 * in a now-hidden field. */
function effectiveGuardian(values: PatientFormValues, today: string) {
  const shown = showGuardian(values, today);
  return {
    guardianName: shown ? values.guardianName : '',
    guardianPhone: shown ? values.guardianPhone : '',
  };
}

function normalizedPhoneOf(text: string, country: string): string {
  const parsed = normalizePhone(text, country as PhoneCountry);
  return parsed ? parsed.e164 : text.trim();
}

/** Compares each patchable field the way it should be compared for "did this actually change":
 * phone by its parsed E.164 (re-typing the same number in a different format isn't a change),
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

/**
 * Only the fields that actually changed since `initial`, normalised as `normalizedFieldValue`
 * describes — `null` (not run through `patientPatchSchema`, which requires at least one key) when
 * nothing did. `sex` has no "unset" state to compare against blank, so it's included whenever it
 * differs like any other field.
 */
export function toPatchPayload(
  initial: PatientFormValues,
  current: PatientFormValues,
  today: string,
  country: string,
): PatientPatch | null {
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

  if (initial.primaryDentistUserId !== current.primaryDentistUserId) {
    patch.primaryDentistUserId = current.primaryDentistUserId || null;
  }

  const initialAlerts = parseAlerts(initial.alertsText);
  const currentAlerts = parseAlerts(current.alertsText);
  if (
    initialAlerts.length !== currentAlerts.length ||
    initialAlerts.some((alert, index) => alert !== currentAlerts[index])
  ) {
    patch.medicalAlerts = currentAlerts;
  }

  const initialGuardian = effectiveGuardian(initial, today);
  const currentGuardian = effectiveGuardian(current, today);
  if (initialGuardian.guardianName.trim() !== currentGuardian.guardianName.trim()) {
    patch.guardianName = currentGuardian.guardianName.trim() || null;
  }
  if (
    normalizedPhoneOf(initialGuardian.guardianPhone, country) !==
    normalizedPhoneOf(currentGuardian.guardianPhone, country)
  ) {
    patch.guardianPhone = currentGuardian.guardianPhone.trim() || null;
  }

  if (Object.keys(patch).length === 0) return null;
  return patientPatchSchema.parse(patch);
}

/** Edit-mode "Unsaved changes" check (design Q16): whether saving would actually send a patch,
 * using `toPatchPayload`'s own normalised comparison (phone by parsed E.164, email case/
 * whitespace-insensitively, everything else trimmed) — so re-typing the same phone number in a
 * different format, or a guardian field that's simply hidden again, never shows "Unsaved". */
export function isEditDirty(
  initial: PatientFormValues,
  current: PatientFormValues,
  today: string,
  country: string,
): boolean {
  return toPatchPayload(initial, current, today, country) !== null;
}

/** `POST /billing/opening-balances`'s `openingBalance` leg; only call once `wantsOpeningBalance`
 * is true — an amount of `0` fails `openingBalanceInputSchema`'s "must be greater than zero". The
 * amount is run through `normalizeAmountText` first so a `.5`/`5.` that reached form state some
 * way other than `sanitizeAmount` (e.g. a pre-filled draft) still parses. */
export function toOpeningBalance(values: PatientFormValues, today: string): OpeningBalanceInput {
  return openingBalanceInputSchema.parse({
    amount: normalizeAmountText(values.openingBalanceAmount) || '0',
    asOf: values.openingBalanceAsOf || today,
    note: values.openingBalanceNote,
  });
}
