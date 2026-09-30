import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { problem } from '@/features/patients/patients.test-utils';
import {
  chart,
  FRONT_DESK,
  historyLine,
  mockWorkspace,
  RANA,
  renderWorkspace,
  sent,
  visit,
  VISIT_ID,
} from './workspace.test-utils';

/** The chart card once the chart has loaded (its frame shows skeleton bars before). */
const chartCard = async () => {
  await screen.findByRole('group', { name: 'Upper arch' });
  return screen.getByRole('region', { name: 'Dental chart' });
};

const openDentition = async (name: RegExp | string) => {
  fireEvent.pointerDown(await screen.findByRole('button', { name }), { button: 0, ctrlKey: false });
};

describe('VisitWorkspacePage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lays out the header, the chart card, the tooth aside and the financial bar', async () => {
    mockWorkspace();
    renderWorkspace();
    const card = await chartCard();
    expect(within(card).getByText('Click a tooth to examine it · ← → to move, Esc to deselect'));
    expect(screen.getByText("Today's visit")).toBeTruthy();
    expect(screen.getByText('What you are doing now')).toBeTruthy();
    expect(within(card).getByRole('group', { name: 'Upper arch' })).toBeTruthy();
    expect(within(card).getByText('Treatment')).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Selected tooth' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Treatment plan' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Clinical notes' })).toBeTruthy();
    expect(screen.getByRole('contentinfo', { name: 'Visit money' })).toBeTruthy();
  });

  it('Review & complete opens the visit summary over the workspace', async () => {
    mockWorkspace();
    renderWorkspace();
    await chartCard();
    fireEvent.click(screen.getByRole('button', { name: 'Review & complete' }));
    expect(await screen.findByRole('dialog', { name: 'Complete visit' })).toBeTruthy();
  });

  it('selects a tooth on click, walks with the arrows and deselects with Esc', async () => {
    mockWorkspace();
    renderWorkspace();
    const card = await chartCard();
    const aside = screen.getByRole('complementary', { name: 'Selected tooth' });
    expect(await within(aside).findByText('No tooth selected')).toBeTruthy();

    fireEvent.click(within(card).getByRole('button', { name: /^#16 · Upper right first molar/ }));
    expect(
      within(card)
        .getByRole('button', { name: /^#16 · / })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(within(aside).getByRole('heading', { name: '#16' })).toBeTruthy();
    expect(within(aside).getByText('Upper right first molar')).toBeTruthy();

    // Patient right on the right: 16 is followed by 17 on the upper row.
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(within(aside).getByRole('heading', { name: '#17' })).toBeTruthy();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(within(aside).getByText('No tooth selected')).toBeTruthy();
  });

  it('selects the tooth named by ?tooth= on arrival, then leaves the URL', async () => {
    mockWorkspace();
    const { router } = renderWorkspace({ search: '?tooth=16' });
    const card = await chartCard();
    const aside = screen.getByRole('complementary', { name: 'Selected tooth' });
    expect(await within(aside).findByRole('heading', { name: '#16' })).toBeTruthy();
    expect(
      within(card)
        .getByRole('button', { name: /^#16 · / })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    await waitFor(() => {
      expect(router.state.location.search).toEqual({});
    });
    expect(router.state.location.pathname).toBe(`/visits/${VISIT_ID}`);
  });

  it('selects nothing when ?tooth= names a tooth the chart does not show', async () => {
    mockWorkspace({ chart: chart({ toothStatus: [{ position: '14', present: 'permanent' }] }) });
    const { router } = renderWorkspace({ search: '?tooth=54' });
    await chartCard();
    await waitFor(() => {
      expect(router.state.location.search).toEqual({});
    });
    const aside = screen.getByRole('complementary', { name: 'Selected tooth' });
    expect(within(aside).getByText('No tooth selected')).toBeTruthy();
  });

  it('"Chart it in this visit" selects the tooth here, without navigating', async () => {
    // The chart lists a service on 16 (so the panel links its history), while the history read
    // finds none: the dialog's empty state.
    mockWorkspace({ chart: chart({ history: [historyLine(40, 'Composite filling', '16')] }) });
    const { router } = renderWorkspace();
    const card = await chartCard();
    fireEvent.click(within(card).getByRole('button', { name: /^#16 · / }));
    const aside = screen.getByRole('complementary', { name: 'Selected tooth' });
    fireEvent.click(await within(aside).findByRole('button', { name: 'Full tooth history →' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tooth #16' });
    const entries = router.history.length;
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Chart it in this visit' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(within(aside).getByRole('heading', { name: '#16' })).toBeTruthy();
    expect(router.history.length).toBe(entries);
    expect(router.state.location.search).toEqual({});
  });

  it('opens the tooth history from "Full tooth history →", over the workspace', async () => {
    mockWorkspace({
      chart: chart({ history: [historyLine(40, 'Composite filling', '16')] }),
      toothHistories: [
        {
          toothCode: '16',
          diagnoses: [],
          plans: [],
          services: [historyLine(40, 'Composite filling', '16')],
        },
      ],
    });
    renderWorkspace();
    const card = await chartCard();
    fireEvent.click(within(card).getByRole('button', { name: /^#16 · / }));
    const aside = screen.getByRole('complementary', { name: 'Selected tooth' });
    fireEvent.click(await within(aside).findByRole('button', { name: 'Full tooth history →' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tooth #16' });
    expect(within(dialog).getByText('Upper right first molar · Rana Haddad')).toBeTruthy();
    expect(await within(dialog).findByText('Composite filling')).toBeTruthy();

    // Esc closes the dialog, not the selection.
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(within(aside).getByRole('heading', { name: '#16' })).toBeTruthy();
  });

  it('scrolls the arrowed-to tooth into view, and moves focus with it inside the chart', async () => {
    mockWorkspace();
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    renderWorkspace();
    const card = await chartCard();
    const tooth16 = within(card).getByRole('button', { name: /^#16 · / });
    tooth16.focus();
    fireEvent.click(tooth16);
    fireEvent.keyDown(tooth16, { key: 'ArrowRight' });

    const tooth17 = within(card).getByRole('button', { name: /^#17 · / });
    await waitFor(() => {
      expect(document.activeElement).toBe(tooth17);
    });
    expect(scrolled).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(scrolled.mock.contexts.at(-1)).toBe(tooth17);

    // Focus elsewhere stays where it is.
    const panelHeading = within(
      screen.getByRole('complementary', { name: 'Selected tooth' }),
    ).getByRole('button', { name: /^Diagnosis/ });
    panelHeading.focus();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(panelHeading);
    scrolled.mockRestore();
  });

  it('Esc closes the catalog drawer first, then deselects', async () => {
    mockWorkspace();
    renderWorkspace();
    const card = await chartCard();
    fireEvent.click(within(card).getByRole('button', { name: /^#16 · / }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add diagnosis' }));
    expect(await screen.findByRole('dialog', { name: 'Add diagnosis' })).toBeTruthy();

    // Focus back on the page (the drawer is an aside, not a modal dialog).
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Add diagnosis' })).toBeNull();
    expect(screen.getByRole('heading', { name: '#16' })).toBeTruthy();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.getByText('No tooth selected')).toBeTruthy();
  });

  it('shows the automatic dentition and sets another one, with a toast', async () => {
    const fetchMock = mockWorkspace();
    renderWorkspace();
    await chartCard();
    await openDentition('Dentition: Auto · Mixed (age 8)');
    expect(screen.queryByRole('menuitemradio', { name: 'Back to auto' })).toBeNull();
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Primary' }));

    expect(await screen.findByText('Dentition set to Primary')).toBeTruthy();
    expect(sent(fetchMock, 'PUT', `/patients/${RANA.id}/dentition`)).toEqual({
      override: 'primary',
    });
    // The chart is refetched for the new stage.
    await waitFor(() => {
      const chartReads = fetchMock.mock.calls.filter(
        ([url]) => url === `/api/v1/clinical/patients/${RANA.id}/chart`,
      );
      expect(chartReads.length).toBe(2);
    });
    expect(await screen.findByRole('button', { name: 'Dentition: Primary · set manually' }));
  });

  it('goes back to the automatic dentition', async () => {
    const fetchMock = mockWorkspace({
      patient: { ...RANA, dentitionOverride: 'permanent' },
      chart: chart({ dentition: { stage: 'permanent', source: 'override', ageYears: 8 } }),
    });
    renderWorkspace();
    await chartCard();
    await openDentition('Dentition: Permanent · set manually');
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Back to auto' }));
    expect(await screen.findByText('Dentition back to automatic')).toBeTruthy();
    expect(sent(fetchMock, 'PUT', `/patients/${RANA.id}/dentition`)).toEqual({ override: null });
  });

  it('is read-only for front desk: the dentition is shown, not a control', async () => {
    mockWorkspace();
    renderWorkspace({ permissions: FRONT_DESK });
    const card = await chartCard();
    expect(within(card).getByText('Dentition: Auto · Mixed (age 8)')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: /^Dentition/ })).toBeNull();
    // Looking is allowed: a tooth can still be selected.
    fireEvent.click(within(card).getByRole('button', { name: /^#16 · / }));
    expect(
      within(screen.getByRole('complementary', { name: 'Selected tooth' })).getByRole('heading', {
        name: '#16',
      }),
    ).toBeTruthy();
  });

  it('sends a completed visit to the patient record', async () => {
    mockWorkspace({ visit: visit({ status: 'completed' }) });
    const { router } = renderWorkspace();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/patients/${RANA.id}`);
    });
    expect(await screen.findByText(`Record ${RANA.id}`)).toBeTruthy();
    // Not completed here: no post-visit summary.
    expect(router.state.location.state.postVisit).toBeUndefined();
  });

  it('lands on the record with the post-visit summary when the open visit completes', async () => {
    let current = visit();
    mockWorkspace({ visit: () => current });
    const { router, client } = renderWorkspace();
    await chartCard();

    // Completed elsewhere, picked up by the refetch.
    current = visit({ status: 'completed', completedAt: current.serverNow, durationMinutes: 13 });
    await client.refetchQueries({ queryKey: ['visits'] });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/patients/${RANA.id}`);
    });
    expect(router.state.location.state.postVisit).toBe(VISIT_ID);
  });

  it('leaves for the patient record when the open visit turns 404 (discarded elsewhere)', async () => {
    let current: ReturnType<typeof visit> | null = visit();
    mockWorkspace({ visit: () => current });
    const { router, client } = renderWorkspace();
    await chartCard();

    current = null;
    await client.refetchQueries({ queryKey: ['visits'] });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/patients/${RANA.id}`);
    });
    expect(router.state.location.state.postVisit).toBeUndefined();
  });

  it('offers Try again when the visit fails to load for another reason', async () => {
    const base = mockWorkspace();
    let failing = true;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      failing && url === `/api/v1/visits/${VISIT_ID}`
        ? Promise.resolve(problem(500, 'internal'))
        : base(url, init),
    );
    renderWorkspace();
    expect(await screen.findByText("Couldn't load this visit")).toBeTruthy();
    expect(screen.queryByText('Visit not found')).toBeNull();

    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await chartCard()).toBeTruthy();
  });

  it('says the visit was not found', async () => {
    mockWorkspace({ visit: null });
    renderWorkspace();
    expect(await screen.findByText('Visit not found')).toBeTruthy();
  });
});
