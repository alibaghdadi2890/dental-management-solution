import type { Visit, VisitFinancialSummary } from '@dcm/contracts';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { id, json, problem, SESSION_USER_ID } from '@/features/patients/patients.test-utils';
import {
  chart,
  DENTIST_WRITE,
  diagnosisRecord,
  mockWorkspace,
  OLDER_VISIT_ID,
  RANA,
  renderWorkspace,
  sent,
  treatmentPlan,
  visit,
  VISIT_ID,
  visitService,
} from '../workspace/workspace.test-utils';

const usd = (amount: string) => ({ amount, currency: 'USD' });

/** Three services, the first two on teeth listed out of order, the third jaw-level: $180. */
const SERVICES = [
  visitService(20, 'Composite filling', '26', { surfaces: ['O', 'D'] }),
  visitService(22, 'Fissure sealant', '16', {
    base: usd('40.00'),
    final: usd('40.00'),
  }),
  visitService(24, 'Scaling', null, { base: usd('60.00'), final: usd('60.00') }),
];

const CHARTED = visit({
  services: SERVICES,
  notes: 'Sealed 16.\nReview in six months.',
  money: { subtotal: '180.00', discount: '0.00', total: '180.00', capped: false },
});

/** The visit as the complete route answers it: frozen money, duration, `completed`. */
const completed = (live: Visit): Visit => ({
  ...live,
  status: 'completed',
  completedAt: '2026-09-04T09:13:00.000Z',
  completedBy: SESSION_USER_ID,
  durationMinutes: 13,
  money: { subtotal: '180.00', discount: '18.00', total: '162.00', capped: false },
});

const SUMMARY: VisitFinancialSummary = {
  visitId: VISIT_ID,
  currency: 'USD',
  visit: { total: '162.00', paid: '0.00', outstanding: '162.00' },
  previous: '50.00',
  totalOutstanding: '212.00',
  payments: [],
};

const WITH_PAYMENTS = [...DENTIST_WRITE, 'payment:read' as const];

/** A gate the test opens when it chooses: a held answer goes out once it is released. */
function held() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
}

/** A fake server for the live visit: the discount route stores the discount, complete completes
 * (after `holdComplete`, when given), and Perform now answers once `holdPerform` (when given) is
 * released. */
function liveServer({
  failDiscount = false,
  holdComplete,
  holdPerform,
}: {
  failDiscount?: boolean;
  holdComplete?: Promise<unknown>;
  holdPerform?: Promise<unknown>;
} = {}) {
  let current: Visit = CHARTED;
  const fetchMock = mockWorkspace({
    visit: () => current,
    chart: chart({ plans: [treatmentPlan(40, 'Zircon crown', '36')] }),
    visitSummary: SUMMARY,
    mutation: (method, path, body) => {
      if (method === 'POST' && path === `/visits/${VISIT_ID}/plans/${id(40)}/perform`) {
        const service = visitService(50, 'Zircon crown', '36', { planId: id(40) });
        const record = treatmentPlan(40, 'Zircon crown', '36', {
          status: 'performed',
          performedInVisitId: VISIT_ID,
        });
        return (holdPerform ?? Promise.resolve()).then(() => {
          current = { ...current, services: [...current.services, service] };
          return json({ visit: current, record });
        });
      }
      if (method === 'PATCH' && path === `/visits/${VISIT_ID}/discount`) {
        if (failDiscount) return problem(500, 'internal');
        const { mode, value } = body as { mode: Visit['discountMode']; value: string };
        current = { ...current, discountMode: mode, discountValue: value };
        return json({ visit: current });
      }
      if (method === 'POST' && path === `/visits/${VISIT_ID}/complete`) {
        return (holdComplete ?? Promise.resolve()).then(() => {
          current = completed(current);
          return json({ visit: current });
        });
      }
      return undefined;
    },
  });
  return fetchMock;
}

const openSummary = async () => {
  await screen.findByRole('group', { name: 'Upper arch' });
  fireEvent.click(screen.getByRole('button', { name: 'Review & complete' }));
  return screen.findByRole('dialog', { name: 'Complete visit' });
};

/** A press outside the dialog, on the scrim: Radix acts on the click that ends it. */
const pressScrim = () => {
  fireEvent.pointerDown(document.body);
  fireEvent.click(document.body);
};

/** The figure beside a label in a dialog's rows. */
const figureOf = (scope: HTMLElement, label: string) =>
  within(scope).getByText(label).nextElementSibling?.textContent;

describe('VisitSummaryDialog', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the visit to review: meta tiles, the teeth in FDI order, services, notes', async () => {
    mockWorkspace({ visit: CHARTED });
    renderWorkspace();
    const dialog = await openSummary();
    expect(
      within(dialog).getByText(
        "Review before recording. A completed visit is locked to the patient's history.",
      ),
    ).toBeTruthy();

    expect(figureOf(dialog, 'Date')).toBe('4 Sep 2026');
    expect(await within(dialog).findByText('Dr. Ana Reyes')).toBeTruthy();
    // The running timer: 12:05 of work on the server's clock when the visit was read.
    expect(figureOf(dialog, 'Duration')).toMatch(/^12:0\d$/);
    expect(within(dialog).getByText(/^Timer stops at 12:0\d$/)).toBeTruthy();

    const teeth = within(dialog).getByRole('region', { name: 'Teeth treated' });
    expect(
      within(teeth)
        .getAllByRole('listitem')
        .map((chip) => chip.textContent),
    ).toEqual(['#16', '#26']);

    const services = within(dialog).getByRole('region', { name: 'Services' });
    const rows = within(services)
      .getAllByRole('listitem')
      .map((row) => Array.from(row.children, (cell) => cell.textContent));
    expect(rows).toEqual([
      ['Composite filling', '#26 · O · D', '$80'],
      ['Fissure sealant', '#16', '$40'],
      ['Scaling', 'Jaw', '$60'],
    ]);

    expect(figureOf(dialog, 'Subtotal')).toBe('$180');
    expect(figureOf(dialog, 'Total due')).toBe('$180');
    expect(
      within(dialog).getByText((_, element) => element?.textContent === CHARTED.notes, {
        selector: 'p',
      }),
    ).toBeTruthy();
    expect(within(dialog).queryByText('Recorded for later')).toBeNull();
  });

  it('says when nothing was charted and there are no notes', async () => {
    mockWorkspace();
    renderWorkspace();
    const dialog = await openSummary();
    expect(within(dialog).getByText('No teeth charted in this visit.')).toBeTruthy();
    expect(within(dialog).getByText('No clinical notes entered for this visit.')).toBeTruthy();
  });

  it("edits the footer's discount: one value, live in both directions", async () => {
    mockWorkspace({ visit: CHARTED });
    renderWorkspace();
    await screen.findByRole('group', { name: 'Upper arch' });
    const footer = screen.getByRole('contentinfo', { name: 'Visit money' });
    // Typed in the footer first: the dialog opens with it.
    fireEvent.change(within(footer).getByRole('textbox', { name: 'Visit discount value' }), {
      target: { value: '5' },
    });
    fireEvent.click(within(footer).getByRole('button', { name: 'Review & complete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Complete visit' });
    const input = within(dialog).getByRole('textbox', { name: 'Visit discount value' });
    expect((input as HTMLInputElement).value).toBe('5');

    fireEvent.change(input, { target: { value: '10' } });
    expect(figureOf(dialog, 'Total due')).toBe('$162');
    const footerInput = within(footer).getByRole('textbox', {
      name: 'Visit discount value',
      hidden: true,
    });
    expect((footerInput as HTMLInputElement).value).toBe('10');
    expect(within(footer).getByText('−$18')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Amount' }));
    expect(
      within(footer)
        .getByRole('radio', { name: 'Amount', hidden: true })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(figureOf(dialog, 'Total due')).toBe('$170');
  });

  it('shows the over-subtotal cap warning', async () => {
    mockWorkspace({ visit: CHARTED });
    renderWorkspace();
    const dialog = await openSummary();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Visit discount value' }), {
      target: { value: '120' },
    });
    expect(within(dialog).getByRole('alert').textContent).toBe(
      'Discount exceeds the subtotal — capped at 100%',
    );
    expect(figureOf(dialog, 'Total due')).toBe('$0');
  });

  it('lists what this visit recorded for later, never older records', async () => {
    mockWorkspace({
      visit: CHARTED,
      chart: chart({
        diagnoses: [
          diagnosisRecord(30, 'Occlusal caries', '36'),
          diagnosisRecord(31, 'Old fracture', '11', { recordedInVisitId: OLDER_VISIT_ID }),
        ],
        plans: [
          treatmentPlan(32, 'Crown', '36'),
          treatmentPlan(34, 'Bridge', '46', { recordedInVisitId: OLDER_VISIT_ID }),
          treatmentPlan(36, 'Sealant', '16', {
            status: 'performed',
            performedInVisitId: VISIT_ID,
          }),
        ],
      }),
    });
    renderWorkspace();
    const dialog = await openSummary();
    const later = within(dialog).getByRole('region', { name: 'Recorded for later' });
    expect(within(later).getByText('Not billed in this visit')).toBeTruthy();
    expect(
      within(later)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual(['Diagnosis · Occlusal caries#36', 'Planned · Crown#36$400']);
    expect(figureOf(later, 'Plan estimate')).toBe('$400');
  });

  it('has no "Recorded for later" when the visit recorded nothing new', async () => {
    mockWorkspace({
      visit: CHARTED,
      chart: chart({
        diagnoses: [
          diagnosisRecord(31, 'Old fracture', '11', { recordedInVisitId: OLDER_VISIT_ID }),
        ],
        plans: [treatmentPlan(34, 'Bridge', '46', { recordedInVisitId: OLDER_VISIT_ID })],
      }),
    });
    renderWorkspace();
    const dialog = await openSummary();
    expect(within(dialog).queryByText('Recorded for later')).toBeNull();
  });

  it('keeps the chart keyboard still while open, and Continue editing closes it', async () => {
    mockWorkspace({ visit: CHARTED });
    renderWorkspace();
    await screen.findByRole('group', { name: 'Upper arch' });
    fireEvent.click(screen.getByRole('button', { name: /^#16 · / }));
    const dialog = await openSummary();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue editing' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByRole('heading', { name: '#16' })).toBeTruthy();
  });

  it('Complete sends unsaved edits, completes, and lands on the record with the post-visit summary once', async () => {
    const fetchMock = liveServer();
    const { router } = renderWorkspace({ realRecord: true, permissions: WITH_PAYMENTS });
    const arrivals: string[] = [];
    router.subscribe('onBeforeNavigate', (event) => {
      arrivals.push(event.toLocation.pathname);
    });
    const dialog = await openSummary();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Visit discount value' }), {
      target: { value: '10' },
    });
    // Well before the 700 ms debounce would have sent it.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Complete visit' }));
    expect(within(dialog).getByRole('button', { name: 'Recording…' })).toBeTruthy();

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/patients/${RANA.id}`);
    });
    expect(router.state.location.state.postVisit).toBe(VISIT_ID);
    const writes = fetchMock.mock.calls
      .filter(([, init]) => (init?.method ?? 'GET') !== 'GET')
      .map(([url, init]) => `${init?.method ?? ''} ${url}`);
    expect(writes).toEqual([
      `PATCH /api/v1/visits/${VISIT_ID}/discount`,
      `POST /api/v1/visits/${VISIT_ID}/complete`,
    ]);
    expect(sent(fetchMock, 'PATCH', `/visits/${VISIT_ID}/discount`)).toEqual({
      mode: 'percent',
      value: '10',
    });

    const recorded = await screen.findByRole('dialog', { name: 'Visit recorded' });
    expect(await within(recorded).findByText('Outstanding from earlier visits')).toBeTruthy();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(arrivals.filter((path) => path === `/patients/${RANA.id}`)).toHaveLength(1);

    fireEvent.click(within(recorded).getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(router.state.location.state.postVisit).toBeUndefined();
    expect(router.state.location.pathname).toBe(`/patients/${RANA.id}`);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('waits for a write still in flight (a Perform now) before completing', async () => {
    const perform = held();
    const fetchMock = liveServer({ holdPerform: perform.gate });
    const { router } = renderWorkspace({ realRecord: true, permissions: WITH_PAYMENTS });
    await screen.findByRole('group', { name: 'Upper arch' });
    const board = screen.getByRole('region', { name: 'Treatment plan' });
    fireEvent.click(
      await within(board).findByRole('button', { name: 'Perform now: Zircon crown' }),
    );
    const dialog = await openSummary();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Complete visit' }));
    expect(within(dialog).getByRole('button', { name: 'Recording…' })).toBeTruthy();

    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(sent(fetchMock, 'POST', `/visits/${VISIT_ID}/complete`)).toBeUndefined();

    perform.release();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/patients/${RANA.id}`);
    });
    const writes = fetchMock.mock.calls
      .filter(([, init]) => (init?.method ?? 'GET') !== 'GET')
      .map(([url, init]) => `${init?.method ?? ''} ${url}`);
    expect(writes).toEqual([
      `POST /api/v1/visits/${VISIT_ID}/plans/${id(40)}/perform`,
      `POST /api/v1/visits/${VISIT_ID}/complete`,
    ]);
  });

  it('while recording: the timer stops, the discount is read-only, Esc and the scrim do nothing', async () => {
    // Before the render, so the timer's own ticks run on the fake clock.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const complete = held();
    liveServer({ holdComplete: complete.gate });
    renderWorkspace({ realRecord: true, permissions: WITH_PAYMENTS });

    // Before Complete, Esc and the scrim close it.
    fireEvent.keyDown(await openSummary(), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await openSummary();
    // Radix listens for outside presses from the tick after it opens.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    pressScrim();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    const dialog = await openSummary();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Complete visit' }));
    expect(within(dialog).getByRole('button', { name: 'Recording…' })).toBeTruthy();
    const duration = figureOf(dialog, 'Duration');
    expect(duration).toMatch(/^12:\d\d$/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(figureOf(dialog, 'Duration')).toBe(duration);
    expect(within(dialog).getByText(`Timer stops at ${duration ?? ''}`)).toBeTruthy();
    const input = within(dialog).getByRole('textbox', { name: 'Visit discount value' });
    expect(input.hasAttribute('readonly')).toBe(true);
    expect(within(dialog).getByRole('radio', { name: 'Amount' })).toHaveProperty('disabled', true);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    pressScrim();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByRole('dialog', { name: 'Complete visit' })).toBe(dialog);

    complete.release();
    expect(await screen.findByRole('dialog', { name: 'Visit recorded' })).toBeTruthy();
  });

  it('does not complete on stale values when an edit fails to save', async () => {
    const fetchMock = liveServer({ failDiscount: true });
    const { router } = renderWorkspace({ realRecord: true, permissions: WITH_PAYMENTS });
    const dialog = await openSummary();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Visit discount value' }), {
      target: { value: '10' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Complete visit' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      "Some changes couldn't be saved, so the visit wasn't completed. Retry them, then complete the visit again.",
    );
    expect(sent(fetchMock, 'POST', `/visits/${VISIT_ID}/complete`)).toBeUndefined();
    expect(within(dialog).getByRole('button', { name: 'Complete visit' })).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/visits/${VISIT_ID}`);
  });

  it('says why when the visit could not be completed, and stays open', async () => {
    mockWorkspace({
      visit: CHARTED,
      mutation: (method, path) =>
        method === 'POST' && path === `/visits/${VISIT_ID}/complete`
          ? json(
              {
                type: 'about:blank',
                title: 'Internal Server Error',
                status: 500,
                code: 'internal',
                detail: 'The ledger is unavailable',
              },
              500,
            )
          : undefined,
    });
    const { router } = renderWorkspace();
    const dialog = await openSummary();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Complete visit' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      "Couldn't complete the visit: The ledger is unavailable",
    );
    expect(router.state.location.pathname).toBe(`/visits/${VISIT_ID}`);
  });
});
