import { describe, expect, it } from 'vitest';
import { type Session, sessionSchema } from './session.js';

const session: Session = {
  user: { id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e', displayName: 'Dr. Reyes', email: 'r@x.io' },
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
  branch: { id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d70', name: 'Main St' },
  branches: [{ id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d70', name: 'Main St' }],
  roleNames: ['Dentist'],
  permissions: ['patient:read'],
  idleTimeoutSeconds: 900,
};

describe('sessionSchema', () => {
  it('accepts a clinic session', () => {
    expect(sessionSchema.parse(session)).toEqual(session);
  });

  it('accepts a platform admin outside any clinic with a trusted session', () => {
    const admin = {
      ...session,
      platformAdmin: true,
      tenant: null,
      branch: null,
      branches: [],
      roleNames: [],
      permissions: ['platform:admin'],
      idleTimeoutSeconds: null,
    };
    expect(sessionSchema.safeParse(admin).success).toBe(true);
  });

  it('requires the identity flags', () => {
    const { platformAdmin: _p, ...withoutFlag } = session;
    expect(sessionSchema.safeParse(withoutFlag).success).toBe(false);
  });
});
