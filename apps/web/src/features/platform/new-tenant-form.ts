import {
  deriveSlug,
  type ProvisionTenantRequest,
  provisionTenantRequestSchema,
  TENANT_DEFAULTS,
} from '@dcm/contracts';

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
}

export type NewTenantField = Exclude<keyof NewTenantForm, 'slugEdited'>;

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
};

/** Applies one edit; the slug follows the clinic name until edited directly. */
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
  return { ...form, [field]: value };
}

export function isDirty(form: NewTenantForm): boolean {
  return (Object.keys(EMPTY_NEW_TENANT) as (keyof NewTenantForm)[]).some(
    (key) => key !== 'slugEdited' && form[key] !== EMPTY_NEW_TENANT[key],
  );
}

/** Error keys per field, as the admin namespace names them. */
export type FieldError = 'required' | 'slug' | 'email' | 'password';

const FIELD_BY_PATH: Record<string, NewTenantField> = {
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
};

function errorFor(field: NewTenantField, value: string): FieldError {
  if (value.trim() === '') return 'required';
  if (field === 'slug') return 'slug';
  if (field === 'ownerEmail') return 'email';
  if (field === 'password') return 'password';
  return 'required';
}

/** Validates against the shared contract, so the form and the API agree on every rule. */
export function toProvisionRequest(
  form: NewTenantForm,
):
  | { ok: true; request: ProvisionTenantRequest }
  | { ok: false; errors: Partial<Record<NewTenantField, FieldError>> } {
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
    },
  });
  if (result.success) return { ok: true, request: result.data };

  const errors: Partial<Record<NewTenantField, FieldError>> = {};
  for (const issue of result.error.issues) {
    const field = FIELD_BY_PATH[issue.path.join('.')];
    if (field && !errors[field]) errors[field] = errorFor(field, form[field]);
  }
  return { ok: false, errors };
}
