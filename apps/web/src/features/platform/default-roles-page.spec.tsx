import type { RoleTemplate, Session } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/ui/toast';
import { sessionQueryOptions } from '@/features/auth/session';
import { sent } from '@/features/clinical/workspace/workspace.test-utils';
import { json, mockApi, sessionWith } from '@/features/patients/patients.test-utils';
import { DefaultRolesPage } from './default-roles-page';

const uuid = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c${String(n).padStart(4, '0')}`;
const template = (n: number, key: string, name: string, extra = {}): RoleTemplate => ({
  id: uuid(n),
  key,
  name,
  description: null,
  system: true,
  active: true,
  permissions: ['patient:read', 'visit:read'],
  ...extra,
});
const TEMPLATES = [
  template(1, 'dentist', 'Dentist'),
  template(2, 'frontdesk', 'Front desk'),
  template(3, 'custom_00aa11bb', 'Lab liaison', { system: false, active: false }),
];

/** A platform admin outside any clinic: their session holds no clinic permission. */
const ADMIN: Session = { ...sessionWith(['platform:admin']), platformAdmin: true, tenant: null };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(sessionQueryOptions().queryKey, ADMIN);
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>
          <DefaultRolesPage />
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('DefaultRolesPage (ADR-0056)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('edits a default role: no holders, no reset; an extra one is switched on', async () => {
    const fetchMock = mockApi({
      get: (path) => (path === '/platform/role-templates' ? json(TEMPLATES) : undefined),
      mutation: (method, path) =>
        path.startsWith('/platform/role-templates/') ? json(TEMPLATES[0]) : undefined,
    });
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Default roles' })).toBeTruthy();
    const list = within(await screen.findByRole('region', { name: 'Roles' }));
    expect(list.queryByText(/person|people/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset to default' })).toBeNull();

    fireEvent.click(await screen.findByRole('switch', { name: 'Apply discounts' }));
    const bar = await screen.findByRole('region', { name: '1 unsaved change' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(sent(fetchMock, 'PATCH', `/platform/role-templates/${uuid(1)}`)).toEqual({
        permissions: ['patient:read', 'visit:read', 'visit:discount'],
      });
    });

    fireEvent.click(list.getByRole('switch', { name: 'Role Lab liaison active' }));
    await waitFor(() => {
      expect(sent(fetchMock, 'POST', `/platform/role-templates/${uuid(3)}/reactivate`)).toBeNull();
    });
  });
});
