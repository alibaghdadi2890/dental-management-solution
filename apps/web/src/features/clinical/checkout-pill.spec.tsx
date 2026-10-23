import type { Permission, VisitListItem } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi, sessionWith } from '@/features/patients/patients.test-utils';
import { balanceOf, listVisit } from '@/features/today/today.test-utils';
import { renderShell } from '@/shell/shell.test-utils';

const FRONT_DESK: Permission[] = ['patient:read', 'visit:read', 'payment:read', 'payment:write'];
const ASSISTANT: Permission[] = ['patient:read', 'visit:read', 'visit:read_all', 'visit:write'];

const RANA = listVisit(11, 'Rana Haddad');
const KARIM = listVisit(12, 'Karim Saleh');

const findHeader = async () => within(await screen.findByRole('banner'));

/** Answers the queue and the visits' balances; nothing is in the chair. */
const mockQueue = (visits: VisitListItem[]) =>
  mockApi({
    get: (path) => {
      if (path === '/billing/checkout-queue') {
        return json({
          items: [...visits].reverse().map((visit) => ({ visit, balance: balanceOf(visit) })),
        });
      }
      if (path.startsWith('/visits?')) return json({ items: [], nextCursor: null });
      return undefined;
    },
  });
const queueCalls = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(([url]) => url.startsWith('/api/v1/billing/checkout-queue'));

describe('CheckoutPill', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("counts today's owing visits and links to the Today board, where it is hidden", async () => {
    const fetchMock = mockQueue([KARIM, RANA]);
    const { location } = renderShell({ url: '/patients', session: sessionWith(FRONT_DESK) });
    const header = await findHeader();
    const pill = await header.findByRole('link', { name: 'Checkout · 2' });
    expect(queueCalls(fetchMock)).not.toHaveLength(0);

    fireEvent.click(pill);
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    expect(location().pathname).toBe('/today');
    expect(header.queryByRole('link', { name: /Checkout/ })).toBeNull();
  });

  it('is absent with nothing to collect', async () => {
    const fetchMock = mockQueue([]);
    renderShell({ url: '/visits', session: sessionWith(FRONT_DESK) });
    await screen.findByText('Visits screen');
    await waitFor(() => {
      expect(queueCalls(fetchMock)).toHaveLength(1);
    });
    const header = await findHeader();
    expect(header.queryByRole('link', { name: /Checkout/ })).toBeNull();
  });

  it('is absent, and asks nothing, without payment:read (ADR-0055)', async () => {
    const fetchMock = mockQueue([RANA]);
    renderShell({ url: '/visits', session: sessionWith(ASSISTANT) });
    await screen.findByText('Visits screen');
    const header = await findHeader();
    expect(header.queryByRole('link', { name: /Checkout/ })).toBeNull();
    expect(queueCalls(fetchMock)).toHaveLength(0);
  });
});
