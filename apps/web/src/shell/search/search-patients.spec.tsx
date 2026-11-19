import type { Permission } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  id,
  json,
  listItem,
  mockApi,
  patient,
  sessionWith,
} from '@/features/patients/patients.test-utils';
import { renderShell } from '@/shell/shell.test-utils';

const RANA = patient(1, 'Rana Haddad');
const SAMI = patient(2, 'Sami Khoury');
const RECENT = '/patients?sort=recent&size=10';
const IDS = [RANA.id, SAMI.id].sort().join(',');

/** Two recent patients: Rana has an appointment ahead and owes; Sami has nothing. */
function mockDetails() {
  return mockApi({
    get: (path) => {
      if (path === RECENT) {
        return json({ items: [listItem(RANA), listItem(SAMI)], total: 2, page: 1, size: 10 });
      }
      if (path.startsWith('/scheduling/patients/upcoming?patientIds=')) {
        return json([
          {
            patientId: RANA.id,
            appointmentId: id(60),
            startsAt: '2026-11-21T08:30:00.000Z',
            dentistName: 'Dr. Reyes',
          },
        ]);
      }
      if (path.startsWith('/billing/balances?patientIds=')) {
        return json([
          {
            patientId: RANA.id,
            balances: [{ amount: '40.00', currency: 'USD' }],
            charged: [],
          },
          { patientId: SAMI.id, balances: [], charged: [] },
        ]);
      }
      if (path.startsWith('/billing/balance-states?patientIds=')) {
        return json([
          { patientId: RANA.id, state: 'owes' },
          { patientId: SAMI.id, state: 'settled' },
        ]);
      }
      return undefined;
    },
  });
}

async function openSearch(permissions: Permission[]) {
  const shell = renderShell({ url: '/visits', session: sessionWith(permissions) });
  fireEvent.click(await screen.findByRole('button', { name: 'Find patient' }));
  const dialog = await screen.findByRole('dialog', { name: 'Find patient' });
  return { ...shell, dialog, input: within(dialog).getByRole('combobox') };
}

const rowOf = (dialog: HTMLElement, name: string) =>
  within(dialog).findByRole('row', { name: new RegExp(name) });

describe('SearchPalette — patients’ next appointment, balance and actions (search S9–S11)', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the next appointment and the amount owed with finance:read', async () => {
    mockDetails();
    const { dialog } = await openSearch(['patient:read', 'appointment:read', 'finance:read']);
    const rana = await rowOf(dialog, 'Rana Haddad');
    expect(await within(rana).findByText('Next 21 Nov 2026, 10:30')).toBeTruthy();
    expect(within(rana).getByText('Owes $40')).toBeTruthy();
    const sami = await rowOf(dialog, 'Sami Khoury');
    expect(sami.textContent).not.toContain('Next');
    expect(sami.textContent).not.toContain('Owes');
  });

  it('says only Owes with payment:read, and never asks for the amounts', async () => {
    const fetchMock = mockDetails();
    const { dialog } = await openSearch(['patient:read', 'payment:read']);
    const rana = await rowOf(dialog, 'Rana Haddad');
    expect(await within(rana).findByText('Owes')).toBeTruthy();
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).toContain(`/api/v1/billing/balance-states?patientIds=${IDS}`);
    expect(urls.some((url) => url.includes('/billing/balances?'))).toBe(false);
    expect(urls.some((url) => url.includes('/scheduling/'))).toBe(false);
  });

  it('shows neither without the permissions, and no actions', async () => {
    const fetchMock = mockDetails();
    const { dialog } = await openSearch(['patient:read']);
    const rana = await rowOf(dialog, 'Rana Haddad');
    expect(rana.textContent).not.toContain('Owes');
    expect(within(rana).queryAllByRole('button')).toEqual([]);
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls.some((url) => url.includes('/billing/') || url.includes('/scheduling/'))).toBe(
      false,
    );
  });

  it('Schedule opens the booking for the patient on the Schedule', async () => {
    mockDetails();
    const { dialog, router } = await openSearch(['patient:read', 'appointment:write']);
    const rana = await rowOf(dialog, 'Rana Haddad');
    fireEvent.click(within(rana).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/schedule');
    });
    expect(router.state.location.search).toEqual({ bookFor: RANA.id });
  });

  it('Record payment opens the payment panel for the patient, over the page', async () => {
    mockDetails();
    const { dialog, input, location } = await openSearch([
      'patient:read',
      'payment:read',
      'payment:write',
      'appointment:write',
    ]);
    const rana = await rowOf(dialog, 'Rana Haddad');
    const [, schedule, payment] = within(rana).getAllByRole('gridcell');
    expect(schedule?.textContent).toBe('Schedule');
    // → twice reaches the second action; Enter runs it.
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(input.getAttribute('aria-activedescendant')).toBe(payment?.id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('dialog', { name: 'Record payment' })).toBeTruthy();
    expect(location().pathname).toBe('/visits');
  });
});
