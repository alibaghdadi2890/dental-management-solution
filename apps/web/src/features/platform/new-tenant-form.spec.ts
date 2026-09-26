import { describe, expect, it } from 'vitest';
import { EMPTY_NEW_TENANT, editNewTenant, isDirty, toProvisionRequest } from './new-tenant-form';

describe('new tenant form', () => {
  it('derives the slug from the name until the slug is edited', () => {
    let form = editNewTenant(EMPTY_NEW_TENANT, 'name', 'Northgate Dental');
    expect(form.slug).toBe('northgate-dental');
    form = editNewTenant(form, 'slug', 'northgate');
    form = editNewTenant(form, 'name', 'Northgate Dental Clinic');
    expect(form.slug).toBe('northgate');
  });

  it('starts with the D8 defaults and is clean', () => {
    expect(EMPTY_NEW_TENANT).toMatchObject({
      timeZone: 'Asia/Beirut',
      currency: 'USD',
      locale: 'en',
    });
    expect(isDirty(EMPTY_NEW_TENANT)).toBe(false);
    expect(isDirty(editNewTenant(EMPTY_NEW_TENANT, 'phone', '1'))).toBe(true);
  });

  it('reports every invalid field with a specific message', () => {
    const form = {
      ...editNewTenant(EMPTY_NEW_TENANT, 'slug', 'Bad Slug'),
      ownerEmail: 'nope',
      password: 'short',
    };
    const result = toProvisionRequest(form);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual({
      name: 'required',
      slug: 'slug',
      branchName: 'required',
      ownerName: 'required',
      ownerEmail: 'email',
      password: 'password',
    });
  });

  it('builds the contract request, dropping blank optional fields', () => {
    let form = EMPTY_NEW_TENANT;
    for (const [field, value] of [
      ['name', 'Northgate Dental'],
      ['branchName', 'Main St'],
      ['ownerName', 'Dr. Ana Reyes'],
      ['ownerEmail', 'Ana@Northgate.dental'],
      ['password', 'Kp7r-Wm2x-9tQa'],
    ] as const) {
      form = editNewTenant(form, field, value);
    }
    const result = toProvisionRequest(form);
    expect(result).toEqual({
      ok: true,
      request: {
        clinic: {
          name: 'Northgate Dental',
          slug: 'northgate-dental',
          timeZone: 'Asia/Beirut',
          currency: 'USD',
          locale: 'en',
        },
        firstBranch: { name: 'Main St', address: null, phone: null },
        owner: {
          displayName: 'Dr. Ana Reyes',
          email: 'ana@northgate.dental',
          temporaryPassword: 'Kp7r-Wm2x-9tQa',
        },
      },
    });
  });
});
