import type { Session } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { visibleNav } from './nav-items';

const base: Session = {
  user: { id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e', displayName: 'Jamie Ortiz', email: 'j@x.io' },
  platformAdmin: false,
  mustChangePassword: false,
  tenant: {
    id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f',
    name: 'Northgate Dental',
    slug: 'northgate',
    timeZone: 'Asia/Beirut',
    currency: 'USD',
    locale: 'en',
  },
  branch: null,
  branches: [],
  roleNames: ['Front desk'],
  permissions: [],
  idleTimeoutSeconds: 900,
};
const keys = (items: { key: string }[]) => items.map((item) => item.key);

describe('visibleNav', () => {
  it('shows front desk Patients, Visits and the read-only Catalog (D5)', () => {
    const nav = visibleNav({
      ...base,
      permissions: ['patient:read', 'visit:read', 'catalog:read', 'tenant:read'],
    });
    expect(keys(nav.main)).toEqual(['patients', 'visits']);
    expect(keys(nav.admin)).toEqual(['catalog']);
    expect(nav.platform).toEqual([]);
  });

  it('shows Catalog and Settings to the owner', () => {
    const nav = visibleNav({
      ...base,
      permissions: ['patient:read', 'visit:read', 'catalog:read', 'catalog:write', 'tenant:write'],
    });
    expect(keys(nav.admin)).toEqual(['catalog', 'settings']);
  });

  it('shows a platform admin outside a clinic only the platform group', () => {
    const nav = visibleNav({
      ...base,
      platformAdmin: true,
      tenant: null,
      permissions: ['platform:admin'],
    });
    expect(nav.main).toEqual([]);
    expect(nav.admin).toEqual([]);
    expect(keys(nav.platform)).toEqual(['tenants']);
  });
});
