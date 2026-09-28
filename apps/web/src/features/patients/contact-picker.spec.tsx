import type { ContactLookupItem } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { ContactPicker } from './contact-picker';
import { id, mockApi } from './patients.test-utils';

const MARIA: ContactLookupItem = {
  kind: 'contact',
  contact: {
    id: id(60),
    fullName: 'Maria Haddad',
    phone: '+9613987654',
    email: null,
    linkedPatient: null,
  },
};
const OMAR: ContactLookupItem = {
  kind: 'contact',
  contact: {
    id: id(61),
    fullName: 'Omar Haddad',
    phone: '+9613111222',
    email: null,
    linkedPatient: { id: id(42), displayNumber: 'P-000042', archived: false },
  },
};
const LINA: ContactLookupItem = {
  kind: 'contact',
  contact: {
    id: id(62),
    fullName: 'Lina Haddad',
    phone: null,
    email: null,
    linkedPatient: { id: id(43), displayNumber: 'P-000043', archived: true },
  },
};
const SAMI: ContactLookupItem = {
  kind: 'patient',
  patient: {
    id: id(44),
    displayNumber: 'P-000044',
    fullName: 'Sami Haddad',
    phone: '+33612345678',
    dateOfBirth: '1980-01-01',
  },
};
const ALL = [MARIA, OMAR, LINA, SAMI];

type Props = ComponentProps<typeof ContactPicker>;

function renderPicker(props: Partial<Props> = {}) {
  const onSelect = vi.fn<Props['onSelect']>();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ContactPicker label="Guardian" country="LB" onSelect={onSelect} {...props} />
    </QueryClientProvider>,
  );
  return onSelect;
}

const input = () => screen.getByRole<HTMLInputElement>('combobox', { name: 'Guardian' });
const type = (value: string) => {
  fireEvent.change(input(), { target: { value } });
};
const options = () => screen.queryAllByRole('option');
const lookups = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.map(([url]) => url).filter((url) => url.includes('/contacts/lookup'));

beforeEach(() => {
  // jsdom lays nothing out; the picker keeps the active row in view.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ContactPicker', () => {
  it('is a 36px search box with the placeholder asked for, parent search by default', () => {
    mockApi();
    renderPicker();
    expect(input().placeholder).toBe('Search a parent by name or phone…');
    cleanup();
    renderPicker({ placeholder: 'Search a contact…' });
    expect(input().placeholder).toBe('Search a contact…');
    expect(input().className).toContain('h-9');
  });

  it('looks up once, after typing settles', async () => {
    const fetchMock = mockApi({ lookup: ALL });
    renderPicker();
    type('M');
    type('Ma');
    type('Mar');
    await waitFor(() => {
      expect(options()).toHaveLength(4);
    });
    expect(lookups(fetchMock)).toEqual(['/api/v1/contacts/lookup?q=Mar']);
  });

  it('shows avatar, name, phone and the patient badges', async () => {
    mockApi({ lookup: ALL });
    renderPicker();
    type('Haddad');
    await waitFor(() => {
      expect(options()).toHaveLength(4);
    });
    const [maria, omar, lina, sami] = options();
    expect(within(maria!).getByText('MH')).toBeTruthy();
    expect(within(maria!).getByText('Maria Haddad')).toBeTruthy();
    const phone = within(maria!).getByText('03 987 654');
    expect(phone.getAttribute('dir')).toBe('ltr');
    expect(within(maria!).queryByText(/^Patient/)).toBeNull();
    expect(within(omar!).getByText('Patient P-000042')).toBeTruthy();
    expect(within(omar!).queryByText('Archived')).toBeNull();
    expect(within(lina!).getByText('Patient P-000043')).toBeTruthy();
    expect(within(lina!).getByText('Archived')).toBeTruthy();
    expect(within(sami!).getByText('Patient P-000044')).toBeTruthy();
    expect(within(sami!).getByText('+33 6 12 34 56 78')).toBeTruthy();
  });

  it('leaves out the contacts and patients it is told to', async () => {
    mockApi({ lookup: ALL });
    renderPicker({ excludeContactIds: [id(60)], excludePatientIds: [id(42), id(44)] });
    type('Haddad');
    await waitFor(() => {
      expect(options()).toHaveLength(1);
    });
    expect(within(options()[0]!).getByText('Lina Haddad')).toBeTruthy();
  });

  it('moves with ↑/↓ and picks with Enter', async () => {
    mockApi({ lookup: ALL });
    const onSelect = renderPicker();
    type('Haddad');
    await waitFor(() => {
      expect(options()).toHaveLength(4);
    });
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(options()[2]?.getAttribute('aria-selected')).toBe('true');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[2]?.id);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith({
      target: { patientId: id(44) },
      display: {
        fullName: 'Sami Haddad',
        phone: '+33612345678',
        patientNumber: 'P-000044',
        archived: false,
      },
      relationship: null,
    });
    expect(input().value).toBe('');
  });

  it('picks an existing contact by its contact id, with a click', async () => {
    mockApi({ lookup: ALL });
    const onSelect = renderPicker();
    type('Omar');
    await waitFor(() => {
      expect(options()).toHaveLength(4);
    });
    fireEvent.click(options()[1]!);
    expect(onSelect).toHaveBeenCalledWith({
      target: { contactId: id(61) },
      display: {
        fullName: 'Omar Haddad',
        phone: '+9613111222',
        patientNumber: 'P-000042',
        archived: false,
      },
      relationship: null,
    });
  });

  it('clears the search with Escape, and keeps Escape from closing the panel', async () => {
    mockApi({ lookup: ALL });
    renderPicker();
    type('Haddad');
    await waitFor(() => {
      expect(options()).toHaveLength(4);
    });
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input().dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(input().value).toBe('');
    });
    expect(options()).toHaveLength(0);
  });

  it('says when nothing matches', async () => {
    mockApi({ lookup: [] });
    renderPicker();
    type('zz');
    expect(await screen.findByText('No one matches “zz”')).toBeTruthy();
    expect(options()).toHaveLength(0);
  });

  describe('Add new contact', () => {
    const open = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add new contact' }));
    };
    const field = (name: string) => screen.getByRole<HTMLInputElement>('textbox', { name });
    const add = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    };

    it('reveals name*, phone* and the relationship, pre-filled from the search', async () => {
      mockApi({ lookup: [] });
      renderPicker();
      type('Nadia');
      await screen.findByText('No one matches “Nadia”');
      open();
      expect(field('Name').value).toBe('Nadia');
      expect(field('Phone').value).toBe('');
      expect(field('Name').getAttribute('aria-required')).toBe('true');
      expect(field('Phone').getAttribute('aria-required')).toBe('true');
      const relationship = screen.getByRole<HTMLSelectElement>('combobox', {
        name: 'Relationship',
      });
      expect(relationship.value).toBe('parent');
      expect([...relationship.options].map((option) => option.text)).toEqual([
        'Parent',
        'Spouse',
        'Child',
        'Sibling',
        'Caregiver',
        'Other',
      ]);
    });

    it('pre-fills the phone when the search is digits', async () => {
      mockApi({ lookup: [] });
      renderPicker();
      type('03 123 456');
      await screen.findByText('No one matches “03 123 456”');
      open();
      expect(field('Phone').value).toBe('03 123 456');
      expect(field('Name').value).toBe('');
    });

    it('requires a name and a valid phone for the tenant country', () => {
      mockApi();
      const onSelect = renderPicker();
      open();
      add();
      expect(screen.getAllByText('Required')).toHaveLength(2);
      fireEvent.change(field('Name'), { target: { value: 'Nadia Haddad' } });
      fireEvent.change(field('Phone'), { target: { value: '12' } });
      add();
      expect(screen.getByText('Enter a valid phone number')).toBeTruthy();
      expect(field('Phone').getAttribute('aria-invalid')).toBe('true');
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('emits a new contact with its relationship, and closes', () => {
      mockApi();
      const onSelect = renderPicker();
      open();
      fireEvent.change(field('Name'), { target: { value: '  Nadia Haddad ' } });
      fireEvent.change(field('Phone'), { target: { value: '03 123 456' } });
      fireEvent.change(screen.getByRole('combobox', { name: 'Relationship' }), {
        target: { value: 'sibling' },
      });
      add();
      expect(onSelect).toHaveBeenCalledWith({
        target: { newContact: { fullName: 'Nadia Haddad', phone: '+9613123456', email: null } },
        display: {
          fullName: 'Nadia Haddad',
          phone: '+9613123456',
          patientNumber: null,
          archived: false,
        },
        relationship: 'sibling',
      });
      expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
    });

    it('confirms with Enter without submitting a surrounding form', () => {
      mockApi();
      const submit = vi.fn((event: Event) => {
        event.preventDefault();
      });
      const onSelect = vi.fn<Props['onSelect']>();
      const client = new QueryClient();
      render(
        <QueryClientProvider client={client}>
          <form
            onSubmit={(event) => {
              submit(event.nativeEvent);
            }}
          >
            <ContactPicker label="Guardian" country="LB" onSelect={onSelect} />
          </form>
        </QueryClientProvider>,
      );
      open();
      fireEvent.change(field('Name'), { target: { value: 'Nadia' } });
      fireEvent.change(field('Phone'), { target: { value: '03 123 456' } });
      // jsdom has no implicit submission: what stops the browser's is the prevented keydown.
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      field('Phone').dispatchEvent(enter);
      expect(enter.defaultPrevented).toBe(true);
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(submit).not.toHaveBeenCalled();
    });

    it('goes back to the search with Cancel', () => {
      mockApi();
      renderPicker();
      open();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
      expect(input()).toBeTruthy();
    });
  });
});
