import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, patient, problem, renderRecord } from '../patients.test-utils';

const RANA = patient(1, 'Rana Haddad');

describe('PatientRecordPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the tabs the permissions allow, Overview first', async () => {
    mockApi({ patients: [RANA] });
    renderRecord({ url: `/patients/${RANA.id}` });
    const tabs = await screen.findByRole('tablist', { name: 'Patient record' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Overview', 'Balance & payments', 'Patient information']);
    expect(within(tabs).getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tabpanel', { name: 'Overview' })).toBeTruthy();
  });

  it('selects the tab from ?tab=, and a tab click puts it in the URL', async () => {
    mockApi({ patients: [RANA] });
    const { router } = renderRecord({ url: `/patients/${RANA.id}?tab=information` });
    expect(
      await screen.findByRole('tab', { name: 'Patient information', selected: true }),
    ).toBeTruthy();
    expect(screen.getByRole('tabpanel', { name: 'Patient information' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ tab: 'overview' });
    });
    expect(await screen.findByRole('tabpanel', { name: 'Overview' })).toBeTruthy();
  });

  it('keeps the record one history entry across tabs: All patients returns to the list', async () => {
    mockApi({ patients: [RANA] });
    const { router } = renderRecord({ url: `/patients/${RANA.id}`, before: ['/patients'] });
    fireEvent.click(await screen.findByRole('tab', { name: 'Patient information' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ tab: 'information' });
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ tab: 'overview' });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Complete' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ tab: 'information' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'All patients' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/patients');
    });
  });

  it('moves between tabs from the keyboard', async () => {
    mockApi({ patients: [RANA] });
    const { router } = renderRecord({ url: `/patients/${RANA.id}` });
    const overview = await screen.findByRole('tab', { name: 'Overview' });
    const balance = screen.getByRole('tab', { name: 'Balance & payments' });
    const information = screen.getByRole('tab', { name: 'Patient information' });
    expect(overview.tabIndex).toBe(0);
    expect(information.tabIndex).toBe(-1);
    expect(overview.getAttribute('aria-controls')).toBe(screen.getByRole('tabpanel').id);
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(balance);
    fireEvent.keyDown(information, { key: 'Home' });
    expect(document.activeElement).toBe(overview);
    fireEvent.keyDown(overview, { key: 'End' });
    expect(document.activeElement).toBe(information);
    fireEvent.click(information);
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ tab: 'information' });
    });
    expect(await screen.findByRole('tabpanel', { name: 'Patient information' })).toBeTruthy();
  });

  it('shows the Overview for an unknown tab, or one the session may not open', async () => {
    mockApi({ patients: [RANA] });
    renderRecord({ url: `/patients/${RANA.id}?tab=nope` });
    expect(await screen.findByRole('tab', { name: 'Overview', selected: true })).toBeTruthy();
    cleanup();
    mockApi({ patients: [RANA] });
    renderRecord({ url: `/patients/${RANA.id}?tab=chart` });
    expect(await screen.findByRole('tab', { name: 'Overview', selected: true })).toBeTruthy();
  });

  it('shows skeleton bars, not a spinner, while the patient loads', async () => {
    const base = mockApi({ patients: [RANA] });
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url === `/api/v1/patients/${RANA.id}`
        ? new Promise<Response>(() => undefined)
        : base(url, init),
    );
    renderRecord({ url: `/patients/${RANA.id}` });
    const busy = await screen.findAllByLabelText('Loading patient…');
    expect(busy.length).toBeGreaterThan(0);
    expect(busy.every((element) => element.getAttribute('aria-busy') === 'true')).toBe(true);
    expect(document.querySelector('.animate-spin')).toBeNull();
    expect(screen.getByRole('button', { name: 'All patients' })).toBeTruthy();
  });

  it('says the patient was not found, with a way back to the list', async () => {
    mockApi();
    const { router } = renderRecord({ url: `/patients/${RANA.id}` });
    expect(await screen.findByText('Patient not found')).toBeTruthy();
    expect(
      screen.getByText("This patient doesn't exist in this clinic, or the link is out of date."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'All patients' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/patients');
    });
  });

  it('offers Try again when the patient fails to load', async () => {
    let fail = true;
    mockApi({
      patients: [RANA],
      get: (path) =>
        fail && path === `/patients/${RANA.id}` ? problem(500, 'internal') : undefined,
    });
    renderRecord({ url: `/patients/${RANA.id}` });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText("Couldn't load patient")).toBeTruthy();
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Rana Haddad' })).toBeTruthy();
  });
});
