import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderShell } from '@/shell/shell.test-utils';
import { ALL_PERMISSIONS, sessionWith } from '../patients.test-utils';
import { MONA_ID, mockMona } from './contact-panel.test-utils';

/** The contact panel's money (families C); its flow from ⌘K is in `shell/search/search-palette.spec.tsx`. */
describe('ContactPanel', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows no money without payment:read, and never asks for it', async () => {
    const fetchMock = mockMona();
    renderShell({
      url: '/visits',
      session: sessionWith(ALL_PERMISSIONS.filter((permission) => permission !== 'payment:read')),
    });
    await screen.findByRole('button', { name: 'Find patient' });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Find patient' });
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'mona' } });
    fireEvent.click(await within(dialog).findByRole('row', { name: /Mona Haddad/ }));

    const panel = await screen.findByRole('dialog', { name: 'Mona Haddad' });
    expect(await within(panel).findByRole('link', { name: 'Lina Haddad' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Register as patient' })).toBeTruthy();
    expect(within(panel).queryByText('Family balance')).toBeNull();
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(
      `/api/v1/billing/contacts/${MONA_ID}/family`,
    );
  });
});
