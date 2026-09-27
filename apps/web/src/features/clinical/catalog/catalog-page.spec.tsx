import type { DiagnosisItem, Permission, ServiceItem, Session } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/ui/toast';
import { sessionQueryOptions } from '@/features/auth/session';
import { catalogKeys } from './catalog-api';
import { CatalogPage } from './catalog-page';

const id = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d${String(n).padStart(2, '0')}`;

const service = (n: number, code: string, name: string, category: string, active = true) =>
  ({
    id: id(n),
    code,
    name,
    category,
    chargeUnit: 'per_tooth',
    price: { amount: '30.00', currency: 'USD' },
    frequent: false,
    active,
  }) satisfies ServiceItem;

const SERVICES = [
  service(1, 'EXT', 'Extraction', 'Surgical'),
  service(2, 'CMP', 'Composite', 'Restorative'),
  service(3, 'XRY', 'Periapical X-ray', 'Diagnostic', false),
];
const DIAGNOSES: DiagnosisItem[] = [
  {
    id: id(11),
    code: 'DX-CAR',
    name: 'Dental caries',
    category: 'Caries',
    frequent: true,
    active: true,
  },
];

function sessionWith(permissions: Permission[]): Session {
  return {
    user: { id: id(90), displayName: 'Jamie Ortiz', email: 'j@example.com' },
    platformAdmin: false,
    mustChangePassword: false,
    tenant: {
      id: id(91),
      name: 'Northgate Dental',
      slug: 'northgate',
      timeZone: 'Asia/Beirut',
      currency: 'USD',
      locale: 'en',
    },
    branch: null,
    branches: [],
    roleNames: [],
    permissions,
    idleTimeoutSeconds: 900,
  };
}

function renderCatalog(permissions: Permission[]) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(sessionQueryOptions().queryKey, sessionWith(permissions));
  client.setQueryData(catalogKeys.tab('services', null), SERVICES);
  client.setQueryData(catalogKeys.tab('diagnoses', null), DIAGNOSES);
  const rootRoute = createRootRoute({
    component: () => <CatalogPage tab="services" onTabChange={() => undefined} />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>
          <RouterProvider router={router} />
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const nameInputs = () => screen.getAllByRole('textbox', { name: 'Name' });
const shownNames = () => nameInputs().map((input) => (input as HTMLInputElement).value);

describe('CatalogPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('is read-only without catalog:write, with the explanatory note', async () => {
    renderCatalog(['catalog:read']);
    expect(await screen.findByText(/managed by the clinic owner/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add service' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
    expect(nameInputs().every((input) => input.hasAttribute('readonly'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Frequently used' })).toBeNull();
  });

  it('counts an edit in the save bar and blocks saving a row without a name', async () => {
    renderCatalog(['catalog:read', 'catalog:write']);
    const [extraction] = await screen.findAllByRole('textbox', { name: 'Name' });
    fireEvent.change(extraction!, { target: { value: 'Simple extraction' } });
    const bar = screen.getByRole('region', { name: '1 unsaved change' });
    expect(within(bar).getByRole('button', { name: 'Save changes' })).toHaveProperty(
      'disabled',
      false,
    );

    fireEvent.change(extraction!, { target: { value: ' ' } });
    expect(within(bar).getByText('1 row missing a code or name')).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Save changes' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('flags a duplicate code on the row', async () => {
    renderCatalog(['catalog:read', 'catalog:write']);
    fireEvent.click(await screen.findByRole('button', { name: 'Add service' }));
    const [code] = screen.getAllByRole('textbox', { name: 'Code' });
    fireEvent.change(code!, { target: { value: 'ext' } });
    fireEvent.change(nameInputs()[0]!, { target: { value: 'Another extraction' } });
    expect(screen.getByText('Code EXT is already used by "Extraction"')).toBeTruthy();
    expect(screen.getByText('1 row with a duplicate code')).toBeTruthy();
  });

  it('filters by category pill and hides inactive rows on request', async () => {
    renderCatalog(['catalog:read']);
    await screen.findByText(/managed by the clinic owner/);
    expect(shownNames()).toEqual(['Extraction', 'Composite', 'Periapical X-ray']);

    fireEvent.click(screen.getByRole('button', { name: 'Surgical' }));
    expect(shownNames()).toEqual(['Extraction']);

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show inactive' }));
    expect(shownNames()).toEqual(['Extraction', 'Composite']);
  });

  it('saves the changed rows as one batch', async () => {
    const saved = SERVICES.map((item) => (item.id === id(2) ? { ...item, frequent: true } : item));
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify(saved), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderCatalog(['catalog:read', 'catalog:write']);

    const [, composite] = await screen.findAllByRole('button', { name: 'Frequently used' });
    fireEvent.click(composite!);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Saved 1 catalog change')).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/catalog/services');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(typeof init?.body === 'string' ? init.body : '')).toEqual({
      items: [
        {
          id: id(2),
          code: 'CMP',
          name: 'Composite',
          category: 'Restorative',
          chargeUnit: 'per_tooth',
          price: '30',
          frequent: true,
          active: true,
        },
      ],
    });
    expect(screen.queryByRole('region', { name: /unsaved/ })).toBeNull();
  });
});
