import type { FamilySuggestion } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { todayIn } from '@/lib/format';
import { ALL_PERMISSIONS, id, json, mockApi, renderPanels, sent } from '../patients.test-utils';

/** The Patients list's review strip and the possible families panel (families B). */

const [year = '2026'] = todayIn('Asia/Beirut').split('-');
const childBorn = `${String(Number(year) - 8)}-01-01`;

const HADDAD: FamilySuggestion = {
  phoneKey: '9613123456',
  phone: '+9613123456',
  sameFamilyName: true,
  patients: [
    {
      id: id(1),
      fullName: 'Lina Haddad',
      displayNumber: 'P-000001',
      dateOfBirth: childBorn,
      contactIds: [],
      selfContactId: null,
    },
    {
      id: id(2),
      fullName: 'Omar Haddad',
      displayNumber: 'P-000002',
      dateOfBirth: childBorn,
      contactIds: [],
      selfContactId: null,
    },
  ],
  contacts: [{ id: id(9), fullName: 'Mona Haddad' }],
};

const AOUN: FamilySuggestion = {
  phoneKey: '9613999999',
  phone: '+9613999999',
  sameFamilyName: false,
  patients: [
    {
      id: id(3),
      fullName: 'Rana Aoun',
      displayNumber: 'P-000003',
      dateOfBirth: '1980-01-01',
      contactIds: [],
      selfContactId: null,
    },
    {
      id: id(4),
      fullName: 'Ziad Daher',
      displayNumber: 'P-000004',
      dateOfBirth: '1982-01-01',
      contactIds: [],
      selfContactId: null,
    },
  ],
  contacts: [],
};

const panel = () => screen.findByRole('complementary', { name: 'Possible families' });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Possible families', () => {
  it('shows the count in the review strip; Review & link opens the first card', async () => {
    mockApi({ families: [HADDAD, AOUN] });
    renderPanels({ url: '/' });
    expect(await screen.findByText('2 possible families')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review & link' }));
    const aside = await panel();
    expect(within(aside).getByText('1 of 2')).toBeTruthy();
    expect(within(aside).getByText(/same family name/)).toBeTruthy();
    // Mona, the contact, pays; the children are hers to guard and bill.
    expect(
      within(aside).getByRole<HTMLInputElement>('radio', { name: /Mona Haddad/ }).checked,
    ).toBe(true);
  });

  it('only informs without patient:write', async () => {
    mockApi({ families: [HADDAD] });
    renderPanels({
      url: '/',
      permissions: ALL_PERMISSIONS.filter((permission) => permission !== 'patient:write'),
    });
    expect(await screen.findByText('1 possible family')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Review & link' })).toBeNull();
  });

  it('links the family to the chosen payer with each member’s roles', async () => {
    const fetchMock = mockApi({
      families: [HADDAD],
      mutation: (method, path) =>
        method === 'POST' && path === '/patients/families/link' ? json({ linked: 1 }) : undefined,
    });
    renderPanels({ url: '/?panel=families' });
    const aside = await panel();
    // Omar is left out; Lina keeps the defaults: guardian and billing, Mona her parent.
    fireEvent.click(await within(aside).findByRole('checkbox', { name: 'Omar Haddad' }));
    fireEvent.click(within(aside).getByRole('button', { name: 'Link family' }));
    await screen.findByText('Family linked');
    expect(sent(fetchMock, 'POST', '/patients/families/link')).toEqual({
      payer: { contactId: id(9) },
      members: [
        { patientId: id(1), relationship: 'parent', isGuardian: true, isBillingContact: true },
      ],
    });
  });

  it('links to someone new only once they have a name', async () => {
    const fetchMock = mockApi({
      families: [AOUN],
      mutation: (method, path) =>
        method === 'POST' && path === '/patients/families/link' ? json({ linked: 1 }) : undefined,
    });
    renderPanels({ url: '/?panel=families' });
    const aside = await panel();
    // The oldest adult pays by default; pick someone else instead.
    expect(
      (await within(aside).findByRole<HTMLInputElement>('radio', { name: /Rana Aoun/ })).checked,
    ).toBe(true);
    fireEvent.click(within(aside).getByRole('radio', { name: 'Someone else' }));
    const link = within(aside).getByRole('button', { name: 'Link family' });
    expect(link).toHaveProperty('disabled', true);
    fireEvent.change(within(aside).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Salma Aoun' },
    });
    fireEvent.click(link);
    await screen.findByText('Family linked');
    expect(sent(fetchMock, 'POST', '/patients/families/link')).toMatchObject({
      payer: { newContact: { fullName: 'Salma Aoun', phone: '+9613999999' } },
      members: [
        { patientId: id(3), relationship: 'other', isGuardian: false, isBillingContact: true },
        { patientId: id(4), relationship: 'other', isGuardian: false, isBillingContact: true },
      ],
    });
  });

  it('answers Not a family for everyone in it, and Skip moves to the next card', async () => {
    const fetchMock = mockApi({
      families: [HADDAD, AOUN],
      mutation: (method, path) =>
        method === 'POST' && path === '/patients/families/dismiss'
          ? new Response(null, { status: 204 })
          : undefined,
    });
    renderPanels({ url: '/?panel=families' });
    const aside = await panel();
    fireEvent.click(await within(aside).findByRole('button', { name: 'Skip' }));
    await waitFor(() => {
      expect(within(aside).getByText('2 of 2')).toBeTruthy();
    });
    fireEvent.click(within(aside).getByRole('button', { name: 'Not a family' }));
    await screen.findByText('Marked as not a family');
    expect(sent(fetchMock, 'POST', '/patients/families/dismiss')).toEqual({
      phoneKey: '9613999999',
      people: [id(3), id(4)],
    });
  });
});
