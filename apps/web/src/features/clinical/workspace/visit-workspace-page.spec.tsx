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
    expect(within(aside).getByText('Select a tooth on the chart to examine it.')).toBeTruthy();

    fireEvent.click(within(card).getByRole('button', { name: /^#16 · Upper right first molar/ }));
    expect(
      within(card)
        .getByRole('button', { name: /^#16 · / })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(within(aside).getByText('#16 · Upper right first molar')).toBeTruthy();

    // Patient right on the right: 16 is followed by 17 on the upper row.
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(within(aside).getByText('#17 · Upper right second molar')).toBeTruthy();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(within(aside).getByText('Select a tooth on the chart to examine it.')).toBeTruthy();
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
      within(screen.getByRole('complementary', { name: 'Selected tooth' })).getByText(
        '#16 · Upper right first molar',
      ),
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

  it('says the visit was not found', async () => {
    mockWorkspace({ visit: null });
    renderWorkspace();
    expect(await screen.findByText('Visit not found')).toBeTruthy();
  });
});
