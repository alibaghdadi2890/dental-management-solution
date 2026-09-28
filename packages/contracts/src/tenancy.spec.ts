import { describe, expect, it } from 'vitest';
import {
  branchCreateSchema,
  deriveSlug,
  provisionTenantRequestSchema,
  roomBatchSchema,
  slugSchema,
  tenantSettingsPatchSchema,
} from './tenancy.js';

describe('slugSchema', () => {
  it.each(['northgate', 'north-gate-2', 'abc'])('accepts %j', (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(true);
  });

  it.each(['North Gate', 'ab', '-x-y', 'x-', 'a--b', 'x'.repeat(49)])('rejects %j', (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(false);
  });
});

describe('deriveSlug', () => {
  it('turns a clinic name into a valid slug', () => {
    expect(deriveSlug('Northgate Dental — Main')).toBe('northgate-dental-main');
    expect(deriveSlug('  Clinique Élysée  ')).toBe('clinique-elysee');
    expect(slugSchema.safeParse(deriveSlug('A'.repeat(80))).success).toBe(true);
  });

  it('returns an empty string when nothing usable is left', () => {
    expect(deriveSlug('عيادة')).toBe('');
  });
});

describe('provisionTenantRequestSchema', () => {
  const request = {
    clinic: { name: 'Northgate Dental', slug: 'northgate' },
    firstBranch: { name: 'Main St' },
    owner: {
      displayName: 'Dr. Reyes',
      email: 'Reyes@Example.com',
      temporaryPassword: 'temporary-pw-1',
    },
  };

  it('applies the D8 defaults and normalises the owner email', () => {
    const parsed = provisionTenantRequestSchema.parse(request);
    expect(parsed.clinic).toMatchObject({
      timeZone: 'Asia/Beirut',
      currency: 'USD',
      locale: 'en',
      country: 'LB',
    });
    expect(parsed.owner.email).toBe('reyes@example.com');
  });

  it('accepts an explicit country and rejects an unsupported one', () => {
    const withCountry = { ...request, clinic: { ...request.clinic, country: 'FR' } };
    expect(provisionTenantRequestSchema.parse(withCountry).clinic.country).toBe('FR');
    const invalid = { ...request, clinic: { ...request.clinic, country: 'ZZ' } };
    expect(provisionTenantRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it('makes the owner a dentist unless another practitioner type is chosen', () => {
    expect(provisionTenantRequestSchema.parse(request).owner.practitionerType).toBe('dentist');
    const other = { ...request, owner: { ...request.owner, practitionerType: 'other' } };
    expect(provisionTenantRequestSchema.parse(other).owner.practitionerType).toBe('other');
    const unknown = { ...request, owner: { ...request.owner, practitionerType: 'surgeon' } };
    expect(provisionTenantRequestSchema.safeParse(unknown).success).toBe(false);
  });

  it('applies the password policy to the temporary password', () => {
    const weak = { ...request, owner: { ...request.owner, temporaryPassword: 'short' } };
    expect(provisionTenantRequestSchema.safeParse(weak).success).toBe(false);
  });
});

describe('branches and rooms', () => {
  it('trims names and treats blank optional fields as absent', () => {
    expect(branchCreateSchema.parse({ name: ' Main St ', code: '', phone: ' ' })).toEqual({
      name: 'Main St',
      code: null,
      address: null,
      phone: null,
    });
  });

  it('accepts a batch of room changes', () => {
    const batch = roomBatchSchema.parse({
      items: [
        { branchId: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e', name: 'Room 1', active: true },
        {
          id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f',
          branchId: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e',
          name: 'Room 2',
          code: 'R2',
          active: false,
        },
      ],
    });
    expect(batch.items[0]?.code).toBeNull();
    expect(roomBatchSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it('refuses an empty settings patch', () => {
    expect(tenantSettingsPatchSchema.safeParse({}).success).toBe(false);
    expect(tenantSettingsPatchSchema.safeParse({ locale: 'fr' }).success).toBe(true);
  });

  it('accepts a country change and rejects an unsupported code', () => {
    expect(tenantSettingsPatchSchema.safeParse({ country: 'FR' }).success).toBe(true);
    expect(tenantSettingsPatchSchema.safeParse({ country: 'zz' }).success).toBe(false);
  });
});
