import {
  dedupeAlerts,
  emailSchema,
  isMinor,
  MEDICAL_ALERTS_MAX,
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
 * group is always blank here: an opening balance is create-only (design Q1, Q12). */
export function fromPatient(patient: Patient): PatientFormValues {
  return {
    ...EMPTY,
    fullName: patient.fullName,
    phone: patient.phone,
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
    guardianPhone: patient.guardianPhone ?? '',
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
  | 'guardianPhone';

/** i18n keys, not messages — the panel looks these up in its own namespace. */
export type FormErrorKey =
  'required' | 'invalidPhone' | 'invalidEmail' | 'futureDate' | 'beforeMinDate' | 'tooLong';

export type FormErrors = Partial<Record<FormField, FormErrorKey>>;

/** Mirrors `patients.ts`'s private `DATE_OF_BIRTH_FLOOR`, which the contract doesn't export (it's
 * folded into `dateOfBirthSchema`'s `.refine()`). Duplicated rather than widening that schema's
 * export surface for one constant; a drift here would only make the client warn a moment before
 * the server's own check rejects the same date. */
const DATE_OF_BIRTH_FLOOR = '1900-01-01';

/** A country as `normalizePhone` (`@dcm/contracts`) wants it; kept as `string` at this module's
 * boundary so `apps/web` doesn't need its own `libphonenumber-js` dependency just for the type. */
type PhoneCountry = Parameters<typeof normalizePhone>[1];

const TEXT_FIELD_MAX: Partial<Record<FormField, number>> = {
  address: 240,
  insurance: 120,
  emergencyContact: 160,
  notes: 2000,
  guardianName: 120,
};

export interface ValidateContext {
  /** ISO 3166-1 alpha-2, e.g. the tenant's `country` (phones are parsed against it, design Q3). */
  country: string;
  /** Today in the tenant's own timezone (`todayIn`), never the browser's. */
  today: string;
}

/** True once a valid date of birth makes the patient under 18 on `today` — the guardian fields'
 * visibility rule (design "Create / Edit" panel). An unset or unparsed date never shows it. */
export function showGuardian(values: PatientFormValues, today: string): boolean {
  return values.dateOfBirth !== '' && isMinor(values.dateOfBirth, today);
}

/** Field-level validation, keyed by i18n error code rather than message text (CLAUDE.md §13). */
export function validate(
  values: PatientFormValues,
  { country, today }: ValidateContext,
): FormErrors {
  const errors: FormErrors = {};

  if (values.fullName.trim() === '') {
    errors.fullName = 'required';
  }

  if (values.phone.trim() === '') {
    errors.phone = 'required';
  } else if (!normalizePhone(values.phone, country as PhoneCountry)) {
    errors.phone = 'invalidPhone';
  }

  if (values.dateOfBirth !== '') {
    if (values.dateOfBirth > today) {
      errors.dateOfBirth = 'futureDate';
    } else if (values.dateOfBirth < DATE_OF_BIRTH_FLOOR) {
      errors.dateOfBirth = 'beforeMinDate';
    }
  }

  if (values.email.trim() !== '' && !emailSchema.safeParse(values.email).success) {
    errors.email = 'invalidEmail';
  }

  if (
    showGuardian(values, today) &&
    values.guardianPhone.trim() !== '' &&
    !normalizePhone(values.guardianPhone, country as PhoneCountry)
  ) {
    errors.guardianPhone = 'invalidPhone';
  }

  for (const [field, max] of Object.entries(TEXT_FIELD_MAX) as [FormField, number][]) {
    if (!errors[field] && values[field].length > max) {
      errors[field] = 'tooLong';
    }
  }

  return errors;
}

/** True when any field differs from the form's starting values (the "Unsaved" badge). */
export function isDirty(initial: PatientFormValues, current: PatientFormValues): boolean {
  return (Object.keys(initial) as (keyof PatientFormValues)[]).some(
    (key) => initial[key] !== current[key],
  );
}

/** Comma text → trimmed, de-duplicated, capped alerts (the chip input's model). */
export function parseAlerts(text: string): string[] {
  const items = text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return dedupeAlerts(items).slice(0, MEDICAL_ALERTS_MAX);
}

/** Keeps digits and a single dot, at most two decimal places — the opening-balance amount input
 * (design "Account" group). `'1,234.567'` → `'1234.56'` (thousands separators are just noise;
 * a third decimal is dropped, not rounded, matching `catalog-draft.ts`'s `sanitizePrice`).
 * A lone `.` or `.5` is left as typed: the amount is still being typed, not yet a valid number. */
export function sanitizeAmount(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  const decimals = cleaned
    .slice(dot + 1)
    .replace(/\./g, '')
    .slice(0, 2);
  return `${cleaned.slice(0, dot)}.${decimals}`;
}

/** Whether to call `POST /billing/opening-balances` instead of `POST /patients` (design Q1: "the
 * SPA uses it only when an amount > 0 is entered"). */
export function wantsOpeningBalance(values: PatientFormValues): boolean {
  return Number(values.openingBalanceAmount || '0') > 0;
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

/**
 * Only the fields that actually changed since `initial` — `{}` (not run through
 * `patientPatchSchema`, which requires at least one key) when nothing did. `sex` has no "unset"
 * state to compare against blank, so it's included whenever it differs like any other field.
 */
export function toPatchPayload(
  initial: PatientFormValues,
  current: PatientFormValues,
  today: string,
): PatientPatch | Record<string, never> {
  const patch: Record<string, unknown> = {};

  for (const field of PATCHABLE_TEXT_FIELDS) {
    if (initial[field] !== current[field]) {
      patch[field] = field === 'dateOfBirth' ? current[field] || null : current[field];
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
  if (initialGuardian.guardianName !== currentGuardian.guardianName) {
    patch.guardianName = currentGuardian.guardianName || null;
  }
  if (initialGuardian.guardianPhone !== currentGuardian.guardianPhone) {
    patch.guardianPhone = currentGuardian.guardianPhone || null;
  }

  if (Object.keys(patch).length === 0) return {};
  return patientPatchSchema.parse(patch);
}

/** `POST /billing/opening-balances`'s `openingBalance` leg; only call once `wantsOpeningBalance`
 * is true — an amount of `0` fails `openingBalanceInputSchema`'s "must be greater than zero". */
export function toOpeningBalance(values: PatientFormValues, today: string): OpeningBalanceInput {
  return openingBalanceInputSchema.parse({
    amount: values.openingBalanceAmount || '0',
    asOf: values.openingBalanceAsOf || today,
    note: values.openingBalanceNote,
  });
}
