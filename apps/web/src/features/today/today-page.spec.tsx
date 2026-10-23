import type { Permission, VisitFinancialSummary, VisitListItem } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { visit, VISIT_ID } from '@/features/clinical/workspace/workspace.test-utils';
import { json, mockApi, sessionWith } from '@/features/patients/patients.test-utils';
import { renderShell } from '@/shell/shell.test-utils';
import { balanceOf, listVisit } from './today.test-utils';

const FRONT_DESK: Permission[] = ['patient:read', 'visit:read', 'payment:read', 'payment:write'];
const DENTIST: Permission[] = [...FRONT_DESK, 'visit:write'];
const ASSISTANT: Permission[] = ['patient:read', 'visit:read', 'visit:read_all', 'visit:write'];
/** A dentist granted one patient's money but not collecting it (ADR-0055). */
const READER: Permission[] = ['patient:read', 'visit:read', 'payment:read'];

/** Rana's visit is the one the panel reads (`VISIT_ID`); Karim finished after her. */
const RANA = listVisit(11, 'Rana Haddad', { id: VISIT_ID });
const KARIM = listVisit(12, 'Karim Saleh');
const OMAR = listVisit(13, 'Omar Saleh', {
  status: 'in_progress',
  type: 'examination',
  currentStep: 'findings',
  completedAt: null,
  durationMinutes: null,
  startedAt: '2026-09-04T09:47:55.000Z',
});

const SUMMARY: VisitFinancialSummary = {
  handedOff: false,
  visitId: VISIT_ID,
  currency: 'USD',
  visit: { total: '140.00', paid: '0.00', outstanding: '140.00' },
  previous: '0.00',
  totalOutstanding: '140.00',
  held: '0.00',
  payments: [],
};

/** The queue (newest first, as the API lists it), who is in the chair, and the panel's reads. */
function mockBoard(board: {
  waiting: VisitListItem[];
  chair: VisitListItem[];
  /** What was already paid on a visit, by visit id; nothing by default. */
  paid?: Record<string, string>;
  /** Answers `POST /visits/:id/checkout`; unanswered by default. */
  onCheckOut?: (visitId: string) => Response;
}) {
  return mockApi({
    mutation: (method, path) => {
      const [, visitId] = /^\/visits\/([^/]+)\/checkout$/.exec(path) ?? [];
      return method === 'POST' && visitId ? board.onCheckOut?.(visitId) : undefined;
    },
    get: (path) => {
      if (path === '/billing/checkout-queue') {
        // As the API answers (ADR-0055): oldest first, without the visits already paid on or
        // checked out.
        const unpaid = [...board.waiting]
          .reverse()
          .filter(
            (item) => (board.paid?.[item.id] ?? '0.00') === '0.00' && item.checkedOutAt === null,
          );
        return json({ items: unpaid.map((item) => ({ visit: item, balance: balanceOf(item) })) });
      }
      if (path.startsWith('/visits?')) return json({ items: board.chair, nextCursor: null });
      if (path === `/visits/${VISIT_ID}`) {
        return json(visit({ status: 'completed', completedAt: '2026-09-04T09:11:00.000Z' }));
      }
      if (path === `/billing/visits/${VISIT_ID}/summary`) return json(SUMMARY);
      return undefined;
    },
  });
}

const lane = (name: RegExp) => screen.findByRole('region', { name });

describe('TodayPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('lists who waits for checkout, oldest first, and who is in the chair', async () => {
    const fetchMock = mockBoard({ waiting: [KARIM, RANA], chair: [OMAR] });
    renderShell({ url: '/today', session: sessionWith(FRONT_DESK) });

    const waiting = within(await lane(/^Ready for checkout · 2$/));
    const cards = await waiting.findAllByRole('listitem');
    await waitFor(() => {
      expect(cards.map((card) => card.textContent)).toEqual([
        'Rana HaddadV-000011 · Treatment · Dr. Ana Reyes · Room 1 · finished 12:11Composite filling$140Check out',
        'Karim SalehV-000012 · Treatment · Dr. Ana Reyes · Room 1 · finished 12:12Composite filling$140Check out',
      ]);
    });

    const chair = within(await lane(/^In the chair · 1$/));
    const [seated] = await chair.findAllByRole('listitem');
    // Its type, and the step it is on as a pill (feature 10, V15).
    expect(seated?.textContent).toBe(
      'Omar SalehExamination · Dr. Ana Reyes · Room 1On Findings12:05',
    );
    // The front desk reads the lane; it has no workspace to open.
    expect(chair.queryByRole('link')).toBeNull();
    expect(
      fetchMock.mock.calls.some(([url]) => url.includes('/visits?') && url.includes('in_progress')),
    ).toBe(true);
  });

  it('a visit that took a payment has been checked out: it leaves the lane though it still owes', async () => {
    mockBoard({ waiting: [KARIM, RANA], chair: [], paid: { [RANA.id]: '40.00' } });
    renderShell({ url: '/today', session: sessionWith(FRONT_DESK) });

    const waiting = within(await lane(/^Ready for checkout · 1$/));
    const cards = await waiting.findAllByRole('listitem');
    expect(cards.map((card) => card.textContent)).toEqual([
      'Karim SalehV-000012 · Treatment · Dr. Ana Reyes · Room 1 · finished 12:12Composite filling$140Check out',
    ]);
    expect(screen.queryByText('Rana Haddad')).toBeNull();
  });

  it('says so when nobody waits and nobody is in the chair', async () => {
    mockBoard({ waiting: [], chair: [] });
    renderShell({ url: '/today', session: sessionWith(FRONT_DESK) });
    expect(await screen.findByText('No one is waiting to check out.')).toBeTruthy();
    expect(await screen.findByText('No visit in progress.')).toBeTruthy();
  });

  it('links a live visit to its workspace with visit:write', async () => {
    mockBoard({ waiting: [], chair: [OMAR] });
    renderShell({ url: '/today', session: sessionWith(DENTIST) });
    const chair = within(await lane(/^In the chair · 1$/));
    const link = await chair.findByRole('link', { name: 'Omar Saleh' });
    expect(link.getAttribute('href')).toBe(`/visits/${OMAR.id}`);
  });

  it('Check out opens the checkout dialog, which stays once the visit is paid, until Done', async () => {
    const board = { waiting: [KARIM, RANA], chair: [] as VisitListItem[] };
    mockBoard(board);
    const { router, client } = renderShell({ url: '/today', session: sessionWith(FRONT_DESK) });

    fireEvent.click(await screen.findByRole('button', { name: 'Check out Rana Haddad' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Checkout · Rana Haddad' }));
    expect(router.state.location.search).toEqual({ visit: VISIT_ID });
    expect(await dialog.findByText('Unpaid')).toBeTruthy();
    expect(await dialog.findByText('Outstanding for this visit')).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Print invoice' })).toBeTruthy();

    // Paid from here or elsewhere: the visit leaves the lane, its dialog stays to say so.
    board.waiting = [KARIM];
    await client.invalidateQueries();
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ visit: VISIT_ID });
      expect(screen.getByRole('dialog', { name: 'Checkout · Rana Haddad' })).toBeTruthy();
    });

    fireEvent.click(dialog.getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(router.state.location.search).toEqual({});
    expect(await lane(/^Ready for checkout · 1$/)).toBeTruthy();
  });

  it('Done on a waiting visit closes its checkout: the card leaves the lane unpaid', async () => {
    const closed: string[] = [];
    const board = {
      waiting: [KARIM, RANA],
      chair: [] as VisitListItem[],
      onCheckOut: (visitId: string) => {
        closed.push(visitId);
        board.waiting = [KARIM, { ...RANA, checkedOutAt: '2026-09-04T09:50:00.000Z' }];
        return json({ visit: visit({ status: 'completed' }) });
      },
    };
    mockBoard(board);
    renderShell({ url: '/today', session: sessionWith(FRONT_DESK) });

    fireEvent.click(await screen.findByRole('button', { name: 'Check out Rana Haddad' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Checkout · Rana Haddad' }));
    fireEvent.click(await dialog.findByRole('button', { name: 'Done' }));

    expect(await lane(/^Ready for checkout · 1$/)).toBeTruthy();
    expect(closed).toEqual([VISIT_ID]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check out Rana Haddad' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Check out Karim Saleh' })).toBeTruthy();
  });

  it('Esc only closes the dialog: the visit keeps waiting', async () => {
    const closed: string[] = [];
    mockBoard({
      waiting: [RANA],
      chair: [],
      onCheckOut: (visitId) => {
        closed.push(visitId);
        return json({ visit: visit({ status: 'completed' }) });
      },
    });
    renderShell({ url: '/today', session: sessionWith(FRONT_DESK) });

    fireEvent.click(await screen.findByRole('button', { name: 'Check out Rana Haddad' }));
    const dialog = await screen.findByRole('dialog', { name: 'Checkout · Rana Haddad' });
    await within(dialog).findByRole('button', { name: 'Done' });
    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(closed).toEqual([]);
    expect(await lane(/^Ready for checkout · 1$/)).toBeTruthy();
  });

  it('offers the discount edit in the dialog to a front desk holding visit:discount', async () => {
    mockBoard({ waiting: [RANA], chair: [] });
    vi.setSystemTime(new Date('2026-09-04T10:00:00.000Z'));
    renderShell({
      url: `/today?visit=${VISIT_ID}`,
      session: sessionWith([...FRONT_DESK, 'visit:discount']),
    });
    const dialog = within(await screen.findByRole('dialog', { name: 'Checkout · Rana Haddad' }));
    expect(await dialog.findByRole('button', { name: 'Edit the visit discount' })).toBeTruthy();
  });

  it('shows the chair lane alone without payment:read, and asks nothing about money', async () => {
    const fetchMock = mockBoard({ waiting: [RANA], chair: [OMAR] });
    renderShell({ url: '/today', session: sessionWith(ASSISTANT) });
    expect(await lane(/^In the chair · 1$/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: /^Ready for checkout/ })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/billing/checkout-queue'))).toBe(
      false,
    );
  });

  it('says front desk collects on a card the viewer may not check out (ADR-0055)', async () => {
    mockBoard({ waiting: [RANA], chair: [] });
    renderShell({ url: '/today', session: sessionWith(READER) });
    const waiting = within(await lane(/^Ready for checkout · 1$/));
    expect(await waiting.findByText('Awaiting payment · front desk')).toBeTruthy();
    expect(waiting.queryByRole('button', { name: /Check out/ })).toBeNull();
  });

  it('has nothing to show without visit:read or payment:read', async () => {
    mockBoard({ waiting: [RANA], chair: [OMAR] });
    renderShell({ url: '/today', session: sessionWith(['patient:read']) });
    expect(await screen.findByText('There is nothing for you to collect here.')).toBeTruthy();
  });
});
