import { GRANTABLE_PERMISSIONS, type Permission, type Role, type StaffUser } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sent } from '@/features/clinical/workspace/workspace.test-utils';
import { json, mockApi, sessionWith } from '@/features/patients/patients.test-utils';
import { renderShell } from '@/shell/shell.test-utils';

const uuid = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c${String(n).padStart(4, '0')}`;
const OWNER: Permission[] = [...GRANTABLE_PERMISSIONS];
const BRANCH = { id: uuid(90), name: 'Main St' };

const role = (
  n: number,
  key: string,
  name: string,
  permissions: Permission[],
  extra = {},
): Role => ({
  id: uuid(n),
  key,
  name,
  description: null,
  system: true,
  active: true,
  permissions,
  holders: 1,
  ...extra,
});
const ROLES: Role[] = [
  role(1, 'owner', 'Owner', OWNER),
  role(2, 'dentist', 'Dentist', ['patient:read', 'visit:read', 'visit:write']),
  role(4, 'frontdesk', 'Front desk', [
    'patient:read',
    'visit:read',
    'payment:read',
    'payment:write',
  ]),
];
const DENTIST: StaffUser = {
  id: uuid(10),
  profileId: uuid(11),
  email: 'ana@example.com',
  displayName: 'Dr. Ana Reyes',
  title: null,
  practitionerType: 'dentist',
  primarySpecialty: 'general',
  specialties: ['general'],
  phone: null,
  active: true,
  roles: [{ key: 'dentist', name: 'Dentist' }],
  grants: [],
  effectivePermissions: ['patient:read', 'visit:read', 'visit:write'],
  branches: [BRANCH],
  createdAt: '2026-01-01T10:00:00.000Z',
};

function mockSettings() {
  return mockApi({
    get: (path) => {
      if (path === '/roles') return json(ROLES);
      if (path === '/users') return json([DENTIST]);
      if (path === '/branches') return json([{ ...BRANCH, active: true }]);
      return undefined;
    },
    mutation: (method, path) => {
      if (method === 'PATCH' && path.startsWith('/roles/')) return json(ROLES[2]);
      if (method === 'PUT' && path.endsWith('/grants')) return json(DENTIST);
      return undefined;
    },
  });
}

describe('Settings (ADR-0055)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the owner Dental chart, Staff and Roles; a role reader Roles alone, read-only', async () => {
    mockSettings();
    renderShell({ url: '/settings?tab=roles', session: sessionWith(OWNER) });
    const tabs = within(await screen.findByRole('navigation', { name: 'Settings sections' }));
    expect(tabs.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Dental chart',
      'Staff',
      'Roles',
    ]);
    cleanup();

    mockSettings();
    renderShell({ url: '/settings', session: sessionWith(['role:read']) });
    fireEvent.click(await screen.findByRole('button', { name: /^Dentist/ }));
    expect(await screen.findByText('You can see the roles but not change them.')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New role' })).toBeNull();
  });

  it('keeps the owner role read-only, and saves a switched-on discount for front desk', async () => {
    const fetchMock = mockSettings();
    renderShell({ url: '/settings?tab=roles', session: sessionWith(OWNER) });
    expect(await screen.findByText('The owner role always has every permission.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Front desk/ }));
    fireEvent.click(await screen.findByRole('switch', { name: 'Apply discounts' }));
    const bar = await screen.findByRole('region', { name: '1 unsaved change' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(sent(fetchMock, 'PATCH', `/roles/${uuid(4)}`)).toEqual({
        permissions: [
          'patient:read',
          'visit:read',
          'payment:read',
          'payment:write',
          'visit:discount',
        ],
      });
    });
  });

  it('grants a dentist more on the Access tab: what a role gives is locked, implies tick', async () => {
    const fetchMock = mockSettings();
    renderShell({ url: '/settings?tab=staff', session: sessionWith(OWNER) });
    fireEvent.pointerDown(
      await screen.findByRole('button', { name: 'Actions for Dr. Ana Reyes' }),
      {
        button: 0,
        ctrlKey: false,
        pointerType: 'mouse',
      },
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const panel = within(await screen.findByRole('complementary', { name: 'Dr. Ana Reyes' }));
    fireEvent.click(panel.getByRole('tab', { name: 'Access' }));

    const own = panel.getByRole('switch', { name: 'See own visits' });
    expect(own.getAttribute('aria-checked')).toBe('true');
    expect(own.hasAttribute('disabled')).toBe(true);
    expect(panel.getAllByText('from Dentist')).toHaveLength(3);

    fireEvent.click(panel.getByRole('switch', { name: 'See clinic finances' }));
    expect(
      panel
        .getByRole('switch', { name: 'See patient balances & payments' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.click(panel.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(sent(fetchMock, 'PUT', `/users/${DENTIST.id}/grants`)).toEqual({
        permissions: ['payment:read', 'finance:read'],
      });
    });
  });

  it('lets someone who edits roles but not staff reach a person’s access from the row', async () => {
    mockSettings();
    renderShell({
      url: '/settings?tab=staff',
      session: sessionWith(['user:read', 'role:read', 'role:write', 'patient:read']),
    });
    const row = await screen.findByRole('row', { name: /Dr\. Ana Reyes/ });
    expect(screen.queryByRole('button', { name: 'New user' })).toBeNull();
    fireEvent.click(row);
    const panel = within(await screen.findByRole('complementary', { name: 'Dr. Ana Reyes' }));
    expect(panel.getByRole('tab', { name: 'Access' }).getAttribute('aria-selected')).toBe('true');
    expect(
      panel.getByRole('switch', { name: 'See clinic finances' }).hasAttribute('disabled'),
    ).toBe(false);
    // Assigning roles is staff management: shown, not changeable.
    expect((await panel.findByRole('checkbox', { name: 'Dentist' })).matches(':disabled')).toBe(
      true,
    );
  });
});
