import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_PERMISSIONS, mockApi, sessionWith } from '@/features/patients/patients.test-utils';
import { renderShell } from './shell.test-utils';

const findPatient = () => screen.queryByRole('button', { name: 'Find patient' });
const newPatient = () => screen.queryByRole('button', { name: 'New patient' });

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
  });

  it('New patient keeps the list search when already on /patients, dropping any pre-fill', async () => {
    mockApi();
    const { location } = renderShell({
      url: '/patients?q=rana&view=archived&panel=new&fullName=Old',
      session: sessionWith(ALL_PERMISSIONS),
    });
    await screen.findByText('Patients screen');
    fireEvent.click(newPatient() as HTMLElement);
    await waitFor(() => {
      expect(location().search.fullName).toBeUndefined();
    });
    expect(location().search).toMatchObject({ panel: 'new', q: 'rana', view: 'archived' });
  });

  it('Find patient opens the palette', async () => {
    mockApi();
    renderShell({ url: '/visits', session: sessionWith(ALL_PERMISSIONS) });
    await screen.findByText('Visits screen');
    fireEvent.click(findPatient() as HTMLElement);
    expect(await screen.findByRole('dialog', { name: 'Find patient' })).toBeTruthy();
  });
});
