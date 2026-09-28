import type { Patient } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    const options = within(dialog).getAllByRole('option');
    expect(options).toHaveLength(5);
    const [first] = options;
    expect(within(first as HTMLElement).getByText('Recent 1')).toBeTruthy();
    expect(within(first as HTMLElement).getByText('P-000001')).toBeTruthy();
    expect(within(first as HTMLElement).getByText('03 123 456')).toBeTruthy();
    expect(within(first as HTMLElement).getByText(/^Age \d+$/)).toBeTruthy();
    expect(within(first as HTMLElement).getByText('Never seen')).toBeTruthy();
  });

  it('shows no age when the date of birth is unknown', async () => {
    mockPatients({ [RECENT]: page([patient(1, 'Rana Haddad', { dateOfBirth: null })]) });
    const { dialog } = await openPalette();
    const option = await within(dialog).findByRole('option');
    expect(within(option).queryByText(/^Age/)).toBeNull();
  });

  it('searches once, debounced, and shows at most 8 results', async () => {
    const fetchMock = mockPatients({ [RECENT]: page([]), [search('03')]: page(many(10, 'Match')) });
    const { dialog, input } = await openPalette();
    type(input, '0');
    type(input, '03');
    expect(await within(dialog).findByText('10 results')).toBeTruthy();
    expect(within(dialog).getAllByRole('option')).toHaveLength(8);
    const searches = fetchMock.mock.calls
      .map(([url]) => url)
      .filter((url) => url.startsWith('/api/v1/patients?q='));
    expect(searches).toEqual(['/api/v1/patients?q=03&size=10']);
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
      expect(location().search.panel).toBe(`quick:${id(2)}`);
    });
    expect(location().pathname).toBe('/patients');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a clicked row', async () => {
    mockPatients({ [RECENT]: page(many(3, 'Recent')) });
    const { dialog, location } = await openPalette();
    fireEvent.click(await within(dialog).findByText('Recent 3'));
    await waitFor(() => {
      expect(location().search.panel).toBe(`quick:${id(3)}`);
    });
  });

  it('offers Create "<query>" as a name when nothing matches', async () => {
    mockPatients({ [RECENT]: page([]), [search('Rana')]: page([]) });
    const { dialog, input, location } = await openPalette();
    type(input, 'Rana');
    expect(await within(dialog).findByText('No patient matches "Rana"')).toBeTruthy();
    expect(
      within(dialog).getByText('Search by full name, phone number or patient ID.'),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create "Rana"' }));
    await waitFor(() => {
      expect(location().search).toMatchObject({ panel: 'new', fullName: 'Rana' });
    });
    expect(location().search.phone).toBeUndefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('pre-fills the phone when the unmatched query is digits', async () => {
    mockPatients({ [RECENT]: page([]), [search('0312')]: page([]) });
    const { dialog, input, location } = await openPalette();
    type(input, '0312');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Create "0312"' }));
    await waitFor(() => {
      expect(location().search).toMatchObject({ panel: 'new', phone: '0312' });
    });
    expect(location().search.fullName).toBeUndefined();
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
    expect(within(dialog).getByLabelText('Searching patients').getAttribute('aria-busy')).toBe(
      'true',
    );
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
});
