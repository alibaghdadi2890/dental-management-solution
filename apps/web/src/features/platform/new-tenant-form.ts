import {
  deriveSlug,
  type ProvisionTenantRequest,
  provisionTenantRequestSchema,
  TENANT_DEFAULTS,
} from '@dcm/contracts';
import {
  choiceOnTypeChange,
  DEFAULT_SPECIALTIES,
  sameSpecialties,
  type SpecialtyChoice,
  specialtiesForType,
} from './specialty-choice';

export interface NewTenantForm {
  name: string;
  slug: string;
  /** Once the admin edits the slug by hand it stops following the name. */
  slugEdited: boolean;
  timeZone: string;
  currency: string;
  locale: string;
  country: string;
  branchName: string;
  address: string;
  phone: string;
  ownerName: string;
  ownerEmail: string;
  password: string;
  /** A `PractitionerType`; the contract checks it like the clinic's selects. */
  ownerPractitionerType: string;
  /** Kept while another type is selected; sent only for a dentist owner. */
  ownerSpecialties: SpecialtyChoice;
}

/** The text and select fields; the owner's specialties are edited with `editOwnerSpecialties`. */
export type NewTenantField = Exclude<keyof NewTenantForm, 'slugEdited' | 'ownerSpecialties'>;

export const EMPTY_NEW_TENANT: NewTenantForm = {
  name: '',
  slug: '',
  slugEdited: false,
  ...TENANT_DEFAULTS,
  branchName: '',
  address: '',
  phone: '',
  ownerName: '',
  ownerEmail: '',
  password: '',
  ownerPractitionerType: 'dentist',
  ownerSpecialties: DEFAULT_SPECIALTIES,
};

/**
 * Applies one edit; the slug follows the clinic name until edited directly, and an owner made a
 * dentist with no specialty ticked starts on General dentistry.
 */
export function editNewTenant(
  form: NewTenantForm,
  field: NewTenantField,
  value: string,
): NewTenantForm {
  if (field === 'name') {
    return { ...form, name: value, slug: form.slugEdited ? form.slug : deriveSlug(value) };
  }
  if (field === 'slug') {
    return { ...form, slug: value, slugEdited: true };
  }
  if (field === 'ownerPractitionerType') {
    return {
      ...form,
      ownerPractitionerType: value,
      ownerSpecialties: choiceOnTypeChange(value, form.ownerSpecialties),
    };
  }
  return { ...form, [field]: value };
}

export function isDirty(form: NewTenantForm): boolean {
  return (
    !sameSpecialties(form.ownerSpecialties, EMPTY_NEW_TENANT.ownerSpecialties) ||
    (Object.keys(EMPTY_NEW_TENANT) as (keyof NewTenantForm)[]).some(
      (key) =>
        key !== 'slugEdited' && key !== 'ownerSpecialties' && form[key] !== EMPTY_NEW_TENANT[key],
    )
  );
}

/** Error keys per field, as the admin namespace names them. */
export type FieldError = 'required' | 'slug' | 'email' | 'password' | 'specialties';

export type NewTenantErrors = Partial<Record<NewTenantField | 'ownerSpecialties', FieldError>>;

const FIELD_BY_PATH: Record<string, NewTenantField | 'ownerSpecialties'> = {
  'clinic.name': 'name',
  'clinic.slug': 'slug',
  'clinic.timeZone': 'timeZone',
  'clinic.currency': 'currency',
  'clinic.locale': 'locale',
  'clinic.country': 'country',
  'firstBranch.name': 'branchName',
  'firstBranch.address': 'address',
  'firstBranch.phone': 'phone',
  'owner.displayName': 'ownerName',
  'owner.email': 'ownerEmail',
  'owner.temporaryPassword': 'password',
  'owner.practitionerType': 'ownerPractitionerType',
  'owner.specialties': 'ownerSpecialties',
};

function errorFor(field: NewTenantField | 'ownerSpecialties', form: NewTenantForm): FieldError {
  if (field === 'ownerSpecialties') return 'specialties';
  if (form[field].trim() === '') return 'required';
  if (field === 'slug') return 'slug';
  if (field === 'ownerEmail') return 'email';
  if (field === 'password') return 'password';
  return 'required';
}

/** Validates against the shared contract, so the form and the API agree on every rule. */
export function toProvisionRequest(
  form: NewTenantForm,
): { ok: true; request: ProvisionTenantRequest } | { ok: false; errors: NewTenantErrors } {
  const result = provisionTenantRequestSchema.safeParse({
    clinic: {
      name: form.name,
      slug: form.slug,
      timeZone: form.timeZone,
      currency: form.currency,
      locale: form.locale,
      country: form.country,
    },
    firstBranch: { name: form.branchName, address: form.address, phone: form.phone },
    owner: {
      displayName: form.ownerName,
      email: form.ownerEmail,
      temporaryPassword: form.password,
      practitionerType: form.ownerPractitionerType,
      ...specialtiesForType(form.ownerPractitionerType, form.ownerSpecialties),
    },
  });
  if (result.success) return { ok: true, request: result.data };

  const errors: NewTenantErrors = {};
  for (const issue of result.error.issues) {
    const field = FIELD_BY_PATH[issue.path.join('.')];
    if (field && !errors[field]) errors[field] = errorFor(field, form);
  }
  return { ok: false, errors };
}
