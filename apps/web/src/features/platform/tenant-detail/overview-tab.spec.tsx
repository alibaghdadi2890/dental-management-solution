import type { ServiceItem, Tenant } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { ToastProvider } from '@/components/ui/toast';
import { catalogKeys } from '@/features/clinical/catalog/catalog-api';
import { platformKeys } from '@/features/platform/platform-api';
import { OverviewTab } from './overview-tab';

const tenant: Tenant = {
  id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f',
  name: 'Northgate Dental',
  slug: 'northgate',
  status: 'active',
  timeZone: 'Asia/Beirut',
  currency: 'USD',
  locale: 'en',
  country: 'LB',
  createdAt: '2026-09-26T10:00:00.000Z',
};

const extraction: ServiceItem = {
  id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d01',
  code: 'EXT',
  name: 'Extraction',
  category: 'Surgical',
  chargeUnit: 'per_tooth',
  price: { amount: '30.00', currency: 'USD' },
  frequent: true,
  active: true,
};

const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );

function renderOverview(services: ServiceItem[]) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(platformKeys.branches(tenant.id), []);
  client.setQueryData(platformKeys.rooms(tenant.id), []);
  client.setQueryData(platformKeys.users(tenant.id), []);
  client.setQueryData(catalogKeys.tab('services', tenant.id), services);
  client.setQueryData(catalogKeys.tab('diagnoses', tenant.id), []);
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <OverviewTab tenant={tenant} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('OverviewTab catalog', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('offers no seeding once the clinic has a catalog', () => {
    renderOverview([extraction]);
    expect(screen.queryByRole('button', { name: 'Seed default catalog' })).toBeNull();
  });

  it('seeds an empty clinic once, for the tenant on screen, then hides the button', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url === '/api/v1/catalog/seed-default') return json({ services: 12, diagnoses: 14 });
      if (url === '/api/v1/catalog/services') return json([extraction]);
      return json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderOverview([]);

    fireEvent.click(screen.getByRole('button', { name: 'Seed default catalog' }));

    expect(
      await screen.findByText('Default catalog added: 12 services, 14 diagnoses'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Seed default catalog' })).toBeNull();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('X-Tenant-Id')).toBe(tenant.id);
  });
});
