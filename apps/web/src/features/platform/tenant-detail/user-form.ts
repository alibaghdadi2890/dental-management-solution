import {
  type PractitionerType,
  type StaffUser,
  type StaffUserCreate,
  staffUserCreateSchema,
  type StaffUserPatch,
  staffUserPatchSchema,
} from '@dcm/contracts';
import {
  DEFAULT_SPECIALTIES,
  sameSpecialties,
  type SpecialtyChoice,
  specialtiesForType,
} from '../specialty-choice';

/** The New/Edit user panel. The password is only used when creating. */
export interface UserForm {
  displayName: string;
  email: string;
  title: string;
  practitionerType: PractitionerType;
  /** Kept while another type is selected; sent only for a dentist. */
  specialties: SpecialtyChoice;
  phone: string;
  roleKeys: string[];
  branchIds: string[];
  password: string;
}

export type UserField = keyof UserForm;

/** Error keys per field, as the admin namespace names them (`users.errors.*`). */
export type UserFieldError =
  'required' | 'email' | 'password' | 'roles' | 'branches' | 'specialties' | 'invalid';

export type UserFormErrors = Partial<Record<UserField, UserFieldError>>;

export const EMPTY_USER_FORM: UserForm = {
  displayName: '',
  email: '',
  title: '',
  practitionerType: 'dentist',
  specialties: DEFAULT_SPECIALTIES,
  phone: '',
  roleKeys: [],
  branchIds: [],
  password: '',
};

export function userFormFrom(user: StaffUser): UserForm {
  return {
    displayName: user.displayName,
    email: user.email,
    title: user.title ?? '',
    practitionerType: user.practitionerType,
    specialties: { primarySpecialty: user.primarySpecialty, specialties: user.specialties },
    phone: user.phone ?? '',
    roleKeys: user.roles.map((role) => role.key),
    branchIds: user.branches.map((branch) => branch.id),
    password: '',
  };
}

/** Checkbox-chip toggle: new values go last, so the first branch chosen stays the default. */
export function toggle(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value) => b.includes(value));

function changed(form: UserForm, initial: UserForm): UserField[] {
  return (Object.keys(form) as UserField[]).filter((field) => {
    if (field === 'specialties') {
      // Compared as sent: what the form holds for another type is never sent.
      return !sameSpecialties(
        specialtiesForType(form.practitionerType, form.specialties),
        specialtiesForType(initial.practitionerType, initial.specialties),
      );
    }
    const value = form[field];
    const before = initial[field];
    return Array.isArray(value) && Array.isArray(before)
      ? !sameSet(value, before)
      : value !== before;
  });
}

export function isUserFormDirty(form: UserForm, initial: UserForm): boolean {
  return changed(form, initial).length > 0;
}

const FIELD_BY_PATH: Partial<Record<string, UserField>> = {
  displayName: 'displayName',
  email: 'email',
  title: 'title',
  practitionerType: 'practitionerType',
  primarySpecialty: 'specialties',
  specialties: 'specialties',
  phone: 'phone',
  roleKeys: 'roleKeys',
  branchIds: 'branchIds',
  temporaryPassword: 'password',
};

function errorFor(field: UserField, form: UserForm): UserFieldError {
  if (field === 'roleKeys') return 'roles';
  if (field === 'branchIds') return 'branches';
  if (field === 'specialties') return 'specialties';
  const value = form[field];
  if (typeof value === 'string' && value.trim() === '') return 'required';
  if (field === 'email') return 'email';
  if (field === 'password') return 'password';
  return 'invalid';
}

function errorsOf(issues: readonly { path: readonly PropertyKey[] }[], form: UserForm) {
  const errors: UserFormErrors = {};
  for (const issue of issues) {
    const field = FIELD_BY_PATH[String(issue.path[0])];
    if (field && !errors[field]) errors[field] = errorFor(field, form);
  }
  return errors;
}

/** Validates against the shared contract, so the panel and the API agree on every rule. */
export function toCreateRequest(
  form: UserForm,
): { ok: true; request: StaffUserCreate } | { ok: false; errors: UserFormErrors } {
  const result = staffUserCreateSchema.safeParse({
    displayName: form.displayName,
    email: form.email,
    title: form.title,
    practitionerType: form.practitionerType,
    ...specialtiesForType(form.practitionerType, form.specialties),
    phone: form.phone,
    roleKeys: form.roleKeys,
    branchIds: form.branchIds,
    temporaryPassword: form.password,
  });
  return result.success
    ? { ok: true, request: result.data }
    : { ok: false, errors: errorsOf(result.error.issues, form) };
}

/**
 * Only the fields that changed; `null` when nothing did. The specialties go with any change of
 * type, so a dentist made an assistant sends none and an assistant made a dentist sends theirs.
 */
export function toPatchRequest(
  form: UserForm,
  initial: UserForm,
): { ok: true; patch: StaffUserPatch | null } | { ok: false; errors: UserFormErrors } {
  const fields = changed(form, initial).filter(
    (field) => field !== 'password' && field !== 'email',
  );
  if (fields.length === 0) return { ok: true, patch: null };
  const withSpecialties = fields.includes('specialties') || fields.includes('practitionerType');
  const result = staffUserPatchSchema.safeParse({
    ...Object.fromEntries(
      fields.filter((field) => field !== 'specialties').map((field) => [field, form[field]]),
    ),
    ...(withSpecialties && specialtiesForType(form.practitionerType, form.specialties)),
  });
  return result.success
    ? { ok: true, patch: result.data }
    : { ok: false, errors: errorsOf(result.error.issues, form) };
}
