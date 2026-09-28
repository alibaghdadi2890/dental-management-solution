import type { Patient } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { patientKeys } from './patients-api';
import { renderShell } from '@/shell/shell.test-utils';
import {
  ALL_PERMISSIONS,
  id,
  json,
  listItem,
  mockApi,
  patient,
  problem,
  sessionWith,
} from './patients.test-utils';

const page = (patients: Patient[]) =>
  json({ items: patients.map(listItem), total: patients.length, page: 1, size: 10 });

const many = (count: number, name: string) =>
  Array.from({ length: count }, (_, i) => patient(i + 1, `${name} ${String(i + 1)}`));

const RECENT = '/patients?sort=recent&size=10';
const search = (q: string) => `/patients?q=${encodeURIComponent(q)}&size=10`;

/** Answers `GET /patients` for the given paths (the recent list and each search). */
function mockPatients(pages: Record<string, Response | (() => Response)>) {
  return mockApi({
    get: (path) => {
      const answer = pages[path];
      return typeof answer === 'function' ? answer() : answer?.clone();
    },
  });
}

async function openPalette(url = '/visits', permissions = ALL_PERMISSIONS) {
  const shell = renderShell({ url, session: sessionWith(permissions) });
  await screen.findByRole('button', { name: 'Find patient' });
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  const dialog = await screen.findByRole('dialog', { name: 'Find patient' });
  return { ...shell, dialog, input: within(dialog).getByRole('combobox') };
}

const type = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
};

describe('CommandPalette', () => {
  beforeEach(() => {
    // jsdom has no layout: keeping the active row in view is a no-op here.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('Ctrl+K opens it with the input focused, and Esc closes it', async () => {
    mockPatients({ [RECENT]: page([]) });
    const { input } = await openPalette();
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('⌘K opens it too', async () => {
    mockPatients({ [RECENT]: page([]) });
    renderShell({ url: '/visits', session: sessionWith(ALL_PERMISSIONS) });
    await screen.findByRole('button', { name: 'Find patient' });
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(await screen.findByRole('dialog', { name: 'Find patient' })).toBeTruthy();
  });

  it('lists the 5 most recently updated patients with no query', async () => {
    mockPatients({ [RECENT]: page(many(7, 'Recent')) });
    const { dialog } = await openPalette();
    expect(await within(dialog).findByText('Recent patients')).toBeTruthy();
    expect(within(dialog).getByRole('status').textContent).toBe('Recent patients');
    const options = within(dialog).getAllByRole('option');
    expect(options).toHaveLength(5);
    const [first] = options;
    expect(within(first as HTMLElement).getByText('Recent 1')).toBeTruthy();
    expect(within(first as HTMLElement).getByText('P-000001')).toBeTruthy();
    expect(within(first as HTMLElement).getByText('03 123 456')).toBeTruthy();
    expect(within(first as HTMLElement).getByText(/^Age \d+$/)).toBeTruthy();
    expect(within(first as HTMLElement).getByText('Never seen')).toBeTruthy();
  });

  it('reads "Age —" when the date of birth is unknown', async () => {
    mockPatients({ [RECENT]: page([patient(1, 'Rana Haddad', { dateOfBirth: null })]) });
    const { dialog } = await openPalette();
    const option = await within(dialog).findByRole('option');
    expect(within(option).getByText('Age —')).toBeTruthy();
  });

  it('searches once, debounced, and shows at most 8 results', async () => {
    const fetchMock = mockPatients({ [RECENT]: page([]), [search('03')]: page(many(10, 'Match')) });
    const { dialog, input } = await openPalette();
    type(input, '0');
    type(input, '03');
    expect(await within(dialog).findByText('10 results')).toBeTruthy();
    expect(within(dialog).getByRole('status').textContent).toBe('10 results for “03”');
    expect(within(dialog).getAllByRole('option')).toHaveLength(8);
    const searches = fetchMock.mock.calls
      .map(([url]) => url)
      .filter((url) => url.startsWith('/api/v1/patients?q='));
    expect(searches).toEqual(['/api/v1/patients?q=03&size=10']);
  });

  it('says "via {contact} · {relationship}" under a hit found through a contact’s phone', async () => {
    const karim = patient(1, 'Karim Haddad', { phone: null });
    const lina = patient(2, 'Lina Haddad');
    mockPatients({
      [RECENT]: page([]),
      [search('987')]: json({
        items: [
          {
            ...listItem(karim),
            matchedContact: { fullName: 'Maria Haddad', relationship: 'parent' },
          },
          listItem(lina),
        ],
        total: 2,
        page: 1,
        size: 10,
      }),
    });
    const { dialog, input } = await openPalette();
    type(input, '987');
    const [viaGuardian, own] = await within(dialog).findAllByRole('option');
    expect(within(viaGuardian as HTMLElement).getByText('via Maria Haddad · Parent')).toBeTruthy();
    expect(own?.textContent).not.toContain('via');
  });

  it('moves the active row with the arrow keys and opens it with Enter', async () => {
    mockPatients({ [RECENT]: page(many(3, 'Recent')) });
    const { dialog, input, location } = await openPalette();
    const options = await within(dialog).findAllByRole('option');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]?.id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1]?.id);
    expect(options[1]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(location().pathname).toBe(`/patients/${id(2)}`);
    });
    expect(await screen.findByText('Patient record')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a clicked row', async () => {
    mockPatients({ [RECENT]: page(many(3, 'Recent')) });
    const { dialog, location } = await openPalette();
    fireEvent.click(await within(dialog).findByText('Recent 3'));
    await waitFor(() => {
      expect(location().pathname).toBe(`/patients/${id(3)}`);
    });
  });

  it('offers Create "<query>" as a name when nothing matches, pre-filled outside the URL', async () => {
    mockPatients({ [RECENT]: page([]), [search('Rana')]: page([]) });
    const { dialog, input, location, router } = await openPalette();
    type(input, 'Rana');
    expect(await within(dialog).findByText('No patient matches "Rana"')).toBeTruthy();
    expect(within(dialog).getByRole('status').textContent).toBe(
      'No patient matches "Rana"Search by full name, phone number or patient ID.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create "Rana"' }));
    await waitFor(() => {
      expect(location().search.panel).toBe('new');
    });
    expect(location().state.patientPrefill).toEqual({ fullName: 'Rana' });
    expect(router.state.location.href).not.toContain('Rana');
    expect(screen.queryByRole('dialog', { name: 'Find patient' })).toBeNull();
    expect(await screen.findByRole('textbox', { name: /^Full name/ })).toHaveProperty(
      'value',
      'Rana',
    );
  });

  it('pre-fills the phone when the unmatched query is digits', async () => {
    mockPatients({ [RECENT]: page([]), [search('0312')]: page([]) });
    const { dialog, input, location } = await openPalette();
    type(input, '0312');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Create "0312"' }));
    await waitFor(() => {
      expect(location().search.panel).toBe('new');
    });
    expect(location().state.patientPrefill).toEqual({ phone: '0312' });
  });

  it('searches Arabic-Indic digits as ASCII, and pre-fills them as a phone', async () => {
    const fetchMock = mockPatients({ [RECENT]: page([]), [search('0312')]: page([]) });
    const { dialog, input, location } = await openPalette();
    type(input, '٠٣١٢');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Create "٠٣١٢"' }));
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain('/api/v1/patients?q=0312&size=10');
    await waitFor(() => {
      expect(location().state.patientPrefill).toEqual({ phone: '0312' });
    });
  });

  it('has no Create without patient:write', async () => {
    mockPatients({ [RECENT]: page([]), [search('Rana')]: page([]) });
    const { dialog, input } = await openPalette('/visits', ['patient:read']);
    type(input, 'Rana');
    expect(await within(dialog).findByText('No patient matches "Rana"')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /Create/ })).toBeNull();
  });

  it('shows skeleton rows while loading', async () => {
    const base = mockPatients({});
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url.includes('sort=recent') ? new Promise<Response>(() => undefined) : base(url, init),
    );
    const { dialog } = await openPalette();
    expect(within(dialog).getByRole('status').textContent).toBe('Searching patients');
    expect(within(dialog).queryByRole('option')).toBeNull();
  });

  it('says so when the search fails, and retries', async () => {
    let fail = true;
    mockPatients({
      [RECENT]: () => (fail ? problem(500, 'internal') : page(many(2, 'Recent'))),
    });
    const { dialog } = await openPalette();
    expect(await within(dialog).findByText("Couldn't search patients.")).toBeTruthy();
    fail = false;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findAllByRole('option')).toHaveLength(2);
  });

  it('starts empty again after closing', async () => {
    mockPatients({ [RECENT]: page([]), [search('Rana')]: page([]) });
    const { input } = await openPalette();
    type(input, 'Rana');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Find patient' });
    expect(within(dialog).getByRole('combobox')).toHaveProperty('value', '');
  });

  it('acts on an Enter pressed before the debounce settles, once the results are in', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockPatients({
      [RECENT]: page(many(2, 'Recent')),
      [search('Sami')]: page([patient(7, 'Sami Aoun')]),
    });
    const { dialog, input, location } = await openPalette();
    await within(dialog).findAllByRole('option');
    type(input, 'Sami');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(location().pathname).toBe('/visits');
    await vi.advanceTimersByTimeAsync(250);
    await waitFor(() => {
      expect(location().pathname).toBe(`/patients/${id(7)}`);
    });
  });

  it('names the query in the announcement, so the same count is announced again', async () => {
    mockPatients({
      [RECENT]: page([]),
      [search('ra')]: page([patient(1, 'Rana Haddad')]),
      [search('ram')]: page([patient(2, 'Rami Aoun')]),
    });
    const { dialog, input } = await openPalette();
    type(input, 'ra');
    expect(await within(dialog).findByText('Rana Haddad')).toBeTruthy();
    expect(within(dialog).getByRole('status').textContent).toBe('1 result for “ra”');
    type(input, 'ram');
    expect(await within(dialog).findByText('Rami Aoun')).toBeTruthy();
    expect(within(dialog).getByRole('status').textContent).toBe('1 result for “ram”');
  });

  it('drops a pending Enter when its search fails, so Try again does not act on it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let fail = true;
    mockPatients({
      [RECENT]: page([]),
      [search('Sami')]: () => (fail ? problem(500, 'internal') : page([patient(7, 'Sami Aoun')])),
    });
    const { dialog, input, location } = await openPalette();
    type(input, 'Sami');
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.advanceTimersByTimeAsync(250);
    expect(await within(dialog).findByText("Couldn't search patients.")).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    fail = false;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByText('Sami Aoun')).toBeTruthy();
    expect(location().pathname).toBe('/visits');
    expect(screen.getByRole('dialog', { name: 'Find patient' })).toBeTruthy();
  });

  it('drops a pending Enter once the query changes again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockPatients({
      [RECENT]: page([]),
      [search('Sami')]: page([patient(7, 'Sami Aoun')]),
      [search('Samir')]: page([patient(8, 'Samir Aoun')]),
    });
    const { dialog, input, location } = await openPalette();
    type(input, 'Sami');
    fireEvent.keyDown(input, { key: 'Enter' });
    type(input, 'Samir');
    await vi.advanceTimersByTimeAsync(250);
    expect(await within(dialog).findByText('Samir Aoun')).toBeTruthy();
    expect(location().pathname).toBe('/visits');
  });

  it('opens the active row while the list refreshes in the background', async () => {
    const base = mockPatients({ [RECENT]: page(many(2, 'Recent')) });
    const { dialog, input, location, client } = await openPalette();
    await within(dialog).findAllByRole('option');
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url.includes('sort=recent') ? new Promise<Response>(() => undefined) : base(url, init),
    );
    void client.invalidateQueries({ queryKey: patientKeys.all(null) });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(location().pathname).toBe(`/patients/${id(1)}`);
    });
  });

  it('keeps showing the rows when a background refresh fails', async () => {
    let fail = false;
    mockPatients({
      [RECENT]: () => (fail ? problem(500, 'internal') : page(many(2, 'Recent'))),
    });
    const { dialog, client } = await openPalette();
    await within(dialog).findAllByRole('option');
    fail = true;
    await client.refetchQueries({ queryKey: patientKeys.all(null) });
    expect(within(dialog).getAllByRole('option')).toHaveLength(2);
    expect(within(dialog).queryByText("Couldn't search patients.")).toBeNull();
  });

  it('ignores Enter while an input method is composing', async () => {
    mockPatients({ [RECENT]: page(many(2, 'Recent')) });
    const { dialog, input, location } = await openPalette();
    await within(dialog).findAllByRole('option');
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(screen.getByRole('dialog', { name: 'Find patient' })).toBeTruthy();
    expect(location().pathname).toBe('/visits');
  });

  it('opens the record from the list, and Back returns to the list with its search', async () => {
    mockPatients({ [RECENT]: page(many(2, 'Recent')) });
    const { router, location } = renderShell({
      url: '/patients?q=rana',
      session: sessionWith(ALL_PERMISSIONS),
    });
    await screen.findByRole('heading', { name: 'Patients' });
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Find patient' });
    fireEvent.click(await within(dialog).findByText('Recent 2'));
    await waitFor(() => {
      expect(location().pathname).toBe(`/patients/${id(2)}`);
    });
    router.history.back();
    await waitFor(() => {
      expect(location().pathname).toBe('/patients');
    });
    expect(location().search.q).toBe('rana');
  });

  it('returns focus to the dirty form when its unsaved-changes guard keeps it open', async () => {
    mockPatients({ [RECENT]: page(many(2, 'Recent')) });
    renderShell({ url: '/patients?panel=new', session: sessionWith(ALL_PERMISSIONS) });
    const name = await screen.findByRole('textbox', { name: /^Full name/ });
    fireEvent.change(name, { target: { value: 'Rana' } });
    name.focus();
    fireEvent.keyDown(name, { key: 'k', code: 'KeyK', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Find patient' });
    fireEvent.click(await within(dialog).findByText('Recent 1'));
    const confirm = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(name);
    });
    expect(name).toHaveProperty('value', 'Rana');
  });
});
