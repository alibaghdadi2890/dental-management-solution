import type { Session } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionQueryOptions } from './session';
import { usePermission } from './use-permission';

const session: Session = {
  user: {
    id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e',
    displayName: 'Dr. Reyes',
    email: 'reyes@example.com',
  },
  platformAdmin: false,
  mustChangePassword: false,
  tenant: {
    id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f',
    name: 'Northgate Dental',
    slug: 'northgate',
    timeZone: 'America/New_York',
    currency: 'USD',
    locale: 'en',
  },
  branch: null,
  branches: [],
  roleNames: ['Dentist'],
  permissions: ['patient:read', 'visit:write'],
  idleTimeoutSeconds: 900,
};

function wrapperWith(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('usePermission', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('grants permissions present in the session', () => {
    const client = new QueryClient();
    client.setQueryData(sessionQueryOptions().queryKey, session);

    const { result } = renderHook(() => usePermission('visit:write'), {
      wrapper: wrapperWith(client),
    });

    expect(result.current).toBe(true);
  });

  it('denies permissions missing from the session', () => {
    const client = new QueryClient();
    client.setQueryData(sessionQueryOptions().queryKey, session);

    const { result } = renderHook(() => usePermission('patient:write'), {
      wrapper: wrapperWith(client),
    });

    expect(result.current).toBe(false);
  });

  it('denies by default when there is no session', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('offline')));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient();

    const { result } = renderHook(() => usePermission('patient:read'), {
      wrapper: wrapperWith(client),
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(result.current).toBe(false);
  });
});
