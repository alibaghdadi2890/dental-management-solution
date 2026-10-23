import type { Session } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { patientActions, visibleNav } from './nav-items';

const base: Session = {
  user: { id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e', displayName: 'Jamie Ortiz', email: 'j@x.io' },
  profile: null,
  platformAdmin: false,
  mustChangePassword: false,
  tenant: {
    id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f',
    name: 'Northgate Dental',
    slug: 'northgate',
    timeZone: 'Asia/Beirut',
    currency: 'USD',
    locale: 'en',
    country: 'LB',
    chartMode: 'surface',
    toothNotation: 'fdi',
    chartOrientation: 'patient_right_on_right',
  },
  branch: null,
  branches: [],
  roles: [{ key: 'frontdesk', name: 'Front desk' }],
  permissions: [],
  idleTimeoutSeconds: 900,
};
const keys = (items: { key: string }[]) => items.map((item) => item.key);

describe('visibleNav', () => {
  it('shows Today, Patients, Visits and the read-only Catalog to whoever sees visits', () => {
    const nav = visibleNav({
      ...base,
      permissions: ['patient:read', 'visit:read', 'catalog:read', 'tenant:read'],
    });
    expect(keys(nav.main)).toEqual(['today', 'patients', 'visits']);
    expect(keys(nav.admin)).toEqual(['catalog']);
    expect(nav.platform).toEqual([]);
  });

  it('shows Payments only with the clinic finances (ADR-0055)', () => {
    const desk = visibleNav({
      ...base,
      permissions: ['patient:read', 'visit:read', 'payment:read', 'payment:write'],
    });
    expect(keys(desk.main)).toEqual(['today', 'patients', 'visits']);
    const owner = visibleNav({
      ...base,
      permissions: ['patient:read', 'visit:read', 'payment:read', 'finance:read'],
    });
    expect(keys(owner.main)).toEqual(['today', 'patients', 'visits', 'payments']);
  });

  it('shows Settings with the chart, staff or roles', () => {
    for (const permission of ['tenant:write', 'user:write', 'role:read'] as const) {
      expect(keys(visibleNav({ ...base, permissions: [permission] }).admin)).toEqual(['settings']);
    }
    expect(keys(visibleNav({ ...base, permissions: ['user:read'] }).admin)).toEqual([]);
  });

  it('shows Catalog and Settings to the owner', () => {
    const nav = visibleNav({
      ...base,
      permissions: ['patient:read', 'visit:read', 'catalog:read', 'catalog:write', 'tenant:write'],
    });
    expect(keys(nav.admin)).toEqual(['catalog', 'settings']);
  });

  it('shows Activity between Catalog and Settings to whoever reads the audit log (H7)', () => {
    const owner = visibleNav({
      ...base,
      permissions: ['catalog:read', 'audit:read', 'tenant:write'],
    });
    expect(keys(owner.admin)).toEqual(['catalog', 'activity', 'settings']);
    // A dentist reads the log but not the settings; an assistant reads neither.
    expect(
      keys(visibleNav({ ...base, permissions: ['catalog:read', 'audit:read'] }).admin),
    ).toEqual(['catalog', 'activity']);
    expect(keys(visibleNav({ ...base, permissions: ['catalog:read'] }).admin)).toEqual(['catalog']);
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
    expect(keys(nav.platform)).toEqual(['tenants', 'platformActivity', 'defaultRoles']);
  });
});

describe('patientActions', () => {
  it('offers Find patient with patient:read and New patient with patient:write', () => {
    expect(patientActions({ ...base, permissions: ['patient:read'] })).toEqual({
      find: true,
      create: false,
    });
    expect(patientActions({ ...base, permissions: ['patient:read', 'patient:write'] })).toEqual({
      find: true,
      create: true,
    });
    expect(patientActions({ ...base, permissions: ['visit:read'] })).toEqual({
      find: false,
      create: false,
    });
  });

  it('offers neither outside a clinic or before the session loads', () => {
    const everything = {
      ...base,
      permissions: ['patient:read' as const, 'patient:write' as const],
    };
    expect(patientActions({ ...everything, platformAdmin: true, tenant: null })).toEqual({
      find: false,
      create: false,
    });
    expect(patientActions(undefined)).toEqual({ find: false, create: false });
  });
});
