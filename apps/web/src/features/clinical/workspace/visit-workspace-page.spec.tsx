import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chart,
  FRONT_DESK,
  mockWorkspace,
  RANA,
  renderWorkspace,
  sent,
  visit,
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
    expect(within(card).getByText('5 surfaces per tooth')).toBeTruthy();
    expect(within(card).getByRole('group', { name: 'Upper arch' })).toBeTruthy();
    expect(within(card).getByText('Treatment')).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Selected tooth' })).toBeTruthy();
    expect(screen.getByRole('contentinfo', { name: 'Visit money' })).toBeTruthy();
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
    expect(await screen.findByRole('complementary', { name: 'Add diagnosis' })).toBeTruthy();

    // Focus back on the page (the drawer is an aside, not a modal dialog).
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Add diagnosis' })).toBeNull();
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
  });

  it('says the visit was not found', async () => {
    mockWorkspace({ visit: null });
    renderWorkspace();
    expect(await screen.findByText('Visit not found')).toBeTruthy();
  });
});
