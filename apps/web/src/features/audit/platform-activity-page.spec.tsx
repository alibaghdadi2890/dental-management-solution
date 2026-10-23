import type { PlatformAuditEntry, PlatformTenant, Session } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { sessionQueryOptions } from '@/features/auth/session';
import { sessionWith } from '@/features/patients/patients.test-utils';
import { PlatformActivityPage } from './platform-activity-page';
import {
  PLATFORM_ACTIVITY_DEFAULTS,
  type PlatformActivitySearch,
} from './platform-activity-search';

const uuid = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c${String(n).padStart(4, '0')}`;
const tenant = (n: number, name: string): PlatformTenant => ({
  id: uuid(n),
  name,
  slug: name.toLowerCase(),
  status: 'active',
  timeZone: 'Asia/Beirut',
  currency: 'USD',
  locale: 'en',
  country: 'LB',
  chartMode: 'surface',
  toothNotation: 'fdi',
  chartOrientation: 'patient_right_on_right',
  createdAt: '2026-10-01T10:00:00.000Z',
  branchCount: 1,
  userCount: 2,
});
const ALPHA = tenant(1, 'Alpha Dental');
const BRAVO = tenant(2, 'Bravo Dental');
const entry = (n: number, tenantId: string, patientId: string): PlatformAuditEntry => ({
  id: uuid(100 + n),
  tenantId,
  actorUserId: uuid(50),
  actorKind: 'user',
  actorPlatformAdmin: false,
  action: 'patient.create',
  resourceType: 'patient',
  resourceId: patientId,
  before: null,
  after: null,
  reason: null,
  requestId: null,
  occurredAt: `2026-10-2${n}T09:00:00.000Z`,
  patientId,
  visitId: null,
  area: 'patients',
});

/** The answers depend on the clinic the request names (`X-Tenant-Id`): each has its own names. */
function mockPlatform() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace('/api/v1', '');
    const clinic = new Headers(init?.headers).get('X-Tenant-Id');
    const reply = (body: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
      );
    if (path.startsWith('/platform/tenants')) return reply([ALPHA, BRAVO]);
    if (path.startsWith('/platform/audit')) {
      const items = path.includes(`tenantId=${BRAVO.id}`)
        ? [entry(2, BRAVO.id, uuid(12))]
        : [entry(3, ALPHA.id, uuid(11)), entry(2, BRAVO.id, uuid(12))];
      return reply({ items, nextCursor: null });
    }
    if (path.startsWith('/patients/names')) {
      return reply(
        clinic === ALPHA.id
          ? [{ id: uuid(11), fullName: 'Alma Alpha', displayNumber: 'P-000001' }]
          : [{ id: uuid(12), fullName: 'Bruno Bravo', displayNumber: 'P-000001' }],
      );
    }
    if (path.startsWith('/users')) {
      return reply([]);
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const ADMIN: Session = { ...sessionWith(['platform:admin']), platformAdmin: true, tenant: null };

function Harness() {
  const [search, setSearch] = useState<PlatformActivitySearch>({ ...PLATFORM_ACTIVITY_DEFAULTS });
  return <PlatformActivityPage search={search} onSearch={setSearch} />;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(sessionQueryOptions().queryKey, ADMIN);
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe('PlatformActivityPage (ADR-0057)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists every clinic’s rows with the clinic, names looked up in each clinic', async () => {
    mockPlatform();
    renderPage();
    const alma = await screen.findByRole('row', { name: /Alma Alpha/ });
    expect(alma.textContent).toContain('Alpha Dental');
    const bruno = await screen.findByRole('row', { name: /Bruno Bravo/ });
    expect(bruno.textContent).toContain('Bravo Dental');
    // Named, not linked: the records are in a clinic the admin is not inside.
    expect(screen.queryByRole('link', { name: 'Alma Alpha' })).toBeNull();
  });

  it('narrows to one clinic', async () => {
    const fetchMock = mockPlatform();
    renderPage();
    await screen.findByRole('row', { name: /Alma Alpha/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Clinic' }), {
      target: { value: BRAVO.id },
    });
    await waitFor(() => {
      expect(screen.queryByRole('row', { name: /Alma Alpha/ })).toBeNull();
    });
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url.includes(`/platform/audit?`) && url.includes(BRAVO.id),
      ),
    ).toBe(true);
    expect(await screen.findByRole('row', { name: /Bruno Bravo/ })).toBeTruthy();
  });
});
