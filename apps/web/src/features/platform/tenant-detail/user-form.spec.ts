import type { StaffUser } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_USER_FORM,
  isUserFormDirty,
  toCreateRequest,
  toggle,
  toPatchRequest,
  userFormFrom,
} from './user-form';

const MAIN = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';
const NORTH = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f';

const user: StaffUser = {
  id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d70',
  profileId: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d71',
  email: 'ana@northgate.dental',
  displayName: 'Dr. Ana Reyes',
  title: null,
  practitionerType: 'dentist',
  phone: null,
  active: true,
  roles: [{ key: 'dentist', name: 'Dentist' }],
  branches: [
    { id: MAIN, name: 'Main St' },
    { id: NORTH, name: 'North' },
  ],
  createdAt: '2026-09-26T10:00:00.000Z',
};

describe('toggle', () => {
  it('adds a missing value at the end and removes a present one', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('toCreateRequest', () => {
  it('reports every missing field of an empty form', () => {
    const result = toCreateRequest(EMPTY_USER_FORM);
    expect(result).toEqual({
      ok: false,
      errors: {
        displayName: 'required',
        email: 'required',
        roleKeys: 'roles',
        branchIds: 'branches',
        password: 'required',
      },
    });
  });

  it('checks the email and the password policy', () => {
    const result = toCreateRequest({
      ...EMPTY_USER_FORM,
      displayName: 'Ana',
      email: 'nope',
      roleKeys: ['dentist'],
      branchIds: [MAIN],
      password: 'short',
    });
    expect(result).toEqual({ ok: false, errors: { email: 'email', password: 'password' } });
  });

  it('builds the request from the shared contract', () => {
    const result = toCreateRequest({
      ...EMPTY_USER_FORM,
      displayName: ' Dr. Ana Reyes ',
      email: 'Ana@Northgate.dental',
      title: '',
      practitionerType: 'dentist',
      roleKeys: ['dentist'],
      branchIds: [NORTH, MAIN],
      password: 'Kp7r-Wm2x-9tQa',
    });
    expect(result).toEqual({
      ok: true,
      request: {
        displayName: 'Dr. Ana Reyes',
        email: 'ana@northgate.dental',
        title: null,
        practitionerType: 'dentist',
        phone: null,
        roleKeys: ['dentist'],
        branchIds: [NORTH, MAIN],
        temporaryPassword: 'Kp7r-Wm2x-9tQa',
      },
    });
  });
});

describe('editing an existing user', () => {
  const initial = userFormFrom(user);

  it('starts clean and treats reordered chips as unchanged', () => {
    expect(isUserFormDirty(initial, initial)).toBe(false);
    expect(isUserFormDirty({ ...initial, branchIds: [NORTH, MAIN] }, initial)).toBe(false);
    expect(isUserFormDirty({ ...initial, title: 'Orthodontist' }, initial)).toBe(true);
    expect(toPatchRequest(initial, initial)).toEqual({ ok: true, patch: null });
  });

  it('sends only what changed', () => {
    const edited = { ...initial, title: 'Orthodontist', roleKeys: ['dentist', 'owner'] };
    expect(toPatchRequest(edited, initial)).toEqual({
      ok: true,
      patch: { title: 'Orthodontist', roleKeys: ['dentist', 'owner'] },
    });
  });

  it('refuses to leave a user without roles or branches', () => {
    expect(toPatchRequest({ ...initial, roleKeys: [], branchIds: [] }, initial)).toEqual({
      ok: false,
      errors: { roleKeys: 'roles', branchIds: 'branches' },
    });
  });
});
