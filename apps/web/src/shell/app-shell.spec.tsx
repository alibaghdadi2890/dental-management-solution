import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_PERMISSIONS, mockApi, sessionWith } from '@/features/patients/patients.test-utils';
import i18n from '@/lib/i18n';
import { renderShell } from './shell.test-utils';

const header = () => within(screen.getByRole('banner'));
const findPatient = () => header().queryByRole('button', { name: 'Find patient' });
const newPatient = () => header().queryByRole('button', { name: 'New patient' });
const ctrlK = () => {
  fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
};

describe('AppShell header', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows Find patient and New patient with patient:read and patient:write', async () => {
    mockApi();
    renderShell({ url: '/visits', session: sessionWith(ALL_PERMISSIONS) });
    await screen.findByText('Visits screen');
    expect(findPatient()).toBeTruthy();
    expect(newPatient()).toBeTruthy();
    expect(findPatient()?.getAttribute('aria-keyshortcuts')).toBe('Control+K Meta+K');
  });

  it('hides Find patient without patient:read, and New patient without patient:write', async () => {
    mockApi();
    renderShell({ url: '/visits', session: sessionWith(['patient:read']) });
    await screen.findByText('Visits screen');
    expect(findPatient()).toBeTruthy();
    expect(newPatient()).toBeNull();
    cleanup();

    mockApi();
    renderShell({ url: '/visits', session: sessionWith(['visit:read']) });
    await screen.findByText('Visits screen');
    expect(findPatient()).toBeNull();
    expect(newPatient()).toBeNull();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hides both for a platform admin who is not acting in a clinic', async () => {
    mockApi();
    renderShell({
      url: '/visits',
      session: { ...sessionWith(ALL_PERMISSIONS), platformAdmin: true, tenant: null },
    });
    await screen.findByText('Visits screen');
    expect(findPatient()).toBeNull();
    expect(newPatient()).toBeNull();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('New patient opens the create panel on /patients', async () => {
    mockApi();
    const { location } = renderShell({ url: '/visits', session: sessionWith(ALL_PERMISSIONS) });
    await screen.findByText('Visits screen');
    fireEvent.click(newPatient() as HTMLElement);
    await waitFor(() => {
      expect(location().pathname).toBe('/patients');
    });
    expect(location().search).toMatchObject({ panel: 'new', view: 'active' });
    expect(location().search.q).toBeUndefined();
    expect(location().state.patientsPanelPushed).toBe(false);
  });

  it('New patient keeps the list search when already on /patients', async () => {
    mockApi();
    const { location } = renderShell({
      url: '/patients?q=rana&view=archived',
      session: sessionWith(ALL_PERMISSIONS),
    });
    await screen.findByRole('heading', { name: 'Patients' });
    fireEvent.click(newPatient() as HTMLElement);
    await waitFor(() => {
      expect(location().search.panel).toBe('new');
    });
    expect(location().search).toMatchObject({ q: 'rana', view: 'archived' });
    expect(location().state.patientsPanelPushed).toBe(true);
    expect(location().state.patientPrefill).toBeUndefined();
  });

  it('Find patient opens the palette, and focus returns to it on close', async () => {
    mockApi();
    renderShell({ url: '/visits', session: sessionWith(ALL_PERMISSIONS) });
    await screen.findByText('Visits screen');
    const button = findPatient() as HTMLElement;
    button.focus();
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Find patient' });
    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Find patient' })).toBeNull();
    });
    expect(document.activeElement).toBe(button);
  });

  it('Ctrl+K closes the palette when it is open', async () => {
    mockApi();
    renderShell({ url: '/visits', session: sessionWith(ALL_PERMISSIONS) });
    await screen.findByText('Visits screen');
    ctrlK();
    expect(await screen.findByRole('dialog', { name: 'Find patient' })).toBeTruthy();
    ctrlK();
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Find patient' })).toBeNull();
    });
  });

  it('Ctrl+K does not open the palette over a confirm dialog', async () => {
    mockApi();
    renderShell({ url: '/patients?panel=new', session: sessionWith(ALL_PERMISSIONS) });
    const name = await screen.findByRole('textbox', { name: /^Full name/ });
    fireEvent.change(name, { target: { value: 'Rana' } });
    fireEvent.keyDown(name, { key: 'Escape' });
    const confirm = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    ctrlK();
    expect(screen.queryByRole('dialog', { name: 'Find patient' })).toBeNull();
    expect(confirm.isConnected).toBe(true);
  });
});

describe('AppShell sidebar', () => {
  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    await i18n.changeLanguage('en');
  });

  it('switches the language from the footer, beside Sign out', async () => {
    mockApi();
    renderShell({ url: '/visits', session: sessionWith(ALL_PERMISSIONS) });
    await screen.findByText('Visits screen');
    const sidebar = within(screen.getByRole('complementary'));
    const trigger = sidebar.getByRole('button', { name: 'Language' });
    expect(trigger.nextElementSibling).toBe(sidebar.getByRole('button', { name: 'Sign out' }));

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'العربية' }));

    expect(await sidebar.findByRole('link', { name: 'المرضى' })).toBeTruthy();
    expect(sidebar.getByRole('button', { name: 'تسجيل الخروج' })).toBeTruthy();
    expect(document.documentElement.dir).toBe('rtl');
  });
});
