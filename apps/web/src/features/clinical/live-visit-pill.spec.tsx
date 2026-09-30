import type { LiveVisitRef, Permission } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi, sessionWith } from '@/features/patients/patients.test-utils';
import { renderShell } from '@/shell/shell.test-utils';
import { liveRef } from './start-visit.test-utils';

const DENTIST: Permission[] = ['patient:read', 'patient:write', 'visit:read', 'visit:write'];
const FRONT_DESK: Permission[] = ['patient:read', 'patient:write', 'visit:read'];

const RANA = liveRef(60, 'Rana Haddad');
const KARIM = liveRef(61, 'Karim Saleh', {
  status: 'paused',
  pausedAt: '2026-09-04T09:05:00.000Z',
});

const findHeader = async () => within(await screen.findByRole('banner'));

/** Answers `GET /visits/live?mine=true` with `live`; returns the fetch mock. */
const mockLive = (live: LiveVisitRef[]) =>
  mockApi({ get: (path) => (path === '/visits/live?mine=true' ? json(live) : undefined) });
const liveCalls = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(([url]) => url.startsWith('/api/v1/visits/live'));

describe('LiveVisitPill', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('links one live visit back to its workspace, with the first name and running time', async () => {
    mockLive([RANA]);
    const { location } = renderShell({ url: '/patients', session: sessionWith(DENTIST) });
    const header = await findHeader();
    const pill = await header.findByRole('link', { name: /Visit in progress · Rana/ });
    expect(pill.textContent).toBe('Visit in progress · Rana12:05');
    expect(pill.getAttribute('href')).toBe(`/visits/${RANA.id}`);
    expect(pill.querySelector('.animate-pulsedot')).toBeTruthy();

    fireEvent.click(pill);
    await screen.findByText(`Workspace ${RANA.id}`);
    expect(location().pathname).toBe(`/visits/${RANA.id}`);
  });

  it('shows a paused visit as paused, its time stopped', async () => {
    mockLive([KARIM]);
    renderShell({ url: '/patients', session: sessionWith(DENTIST) });
    const header = await findHeader();
    const pill = await header.findByRole('link', { name: /Visit paused · Karim/ });
    expect(pill.textContent).toBe('Visit paused · Karim05:00');
    expect(pill.querySelector('.animate-pulsedot')).toBeNull();
  });

  it('lists several live visits in a menu', async () => {
    mockLive([RANA, KARIM]);
    const { location } = renderShell({ url: '/patients', session: sessionWith(DENTIST) });
    const header = await findHeader();
    const trigger = await header.findByRole('button', { name: '2 visits in progress' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Rana HaddadIn progress12:05',
      'Karim SalehPaused05:00',
    ]);

    fireEvent.click(items[1] as HTMLElement);
    await screen.findByText(`Workspace ${KARIM.id}`);
    expect(location().pathname).toBe(`/visits/${KARIM.id}`);
  });

  it('leaves out the visit whose workspace is open', async () => {
    mockLive([RANA, KARIM]);
    renderShell({ url: `/visits/${RANA.id}`, session: sessionWith(DENTIST) });
    await screen.findByText(`Workspace ${RANA.id}`);
    const header = await findHeader();
    expect(await header.findByRole('link', { name: /Visit paused · Karim/ })).toBeTruthy();
    expect(header.queryByRole('button', { name: /visits in progress/ })).toBeNull();
  });

  it('is absent with no live visit', async () => {
    const fetchMock = mockLive([]);
    renderShell({ url: '/visits', session: sessionWith(DENTIST) });
    await screen.findByText('Visits screen');
    await waitFor(() => {
      expect(liveCalls(fetchMock)).toHaveLength(1);
    });
    const header = await findHeader();
    expect(header.queryByRole('link', { name: /Visit/ })).toBeNull();
  });

  it('is hidden from the front desk, who never asks for live visits (W18)', async () => {
    const fetchMock = mockLive([RANA]);
    renderShell({ url: '/visits', session: sessionWith(FRONT_DESK) });
    await screen.findByText('Visits screen');
    const header = await findHeader();
    await header.findByRole('button', { name: 'New patient' });
    expect(header.queryByRole('link', { name: /Visit in progress/ })).toBeNull();
    expect(liveCalls(fetchMock)).toHaveLength(0);
  });

  it('polls every 30 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fetchMock = mockLive([RANA]);
      renderShell({ url: '/patients', session: sessionWith(DENTIST) });
      const header = await findHeader();
      await header.findByRole('link', { name: /Visit in progress · Rana/ });
      expect(liveCalls(fetchMock)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(liveCalls(fetchMock)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
