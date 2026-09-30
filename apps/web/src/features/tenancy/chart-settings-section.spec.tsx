import type {
  ChartMode,
  ChartOrientation,
  Permission,
  Session,
  ToothNotation,
} from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { ToastProvider } from '@/components/ui/toast';
import { sessionQueryOptions } from '@/features/auth/session';
import { ChartSettingsSection } from './chart-settings-section';

const id = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d${String(n).padStart(2, '0')}`;

interface Settings {
  chartMode?: ChartMode;
  toothNotation?: ToothNotation;
  chartOrientation?: ChartOrientation;
}

function sessionWith(permissions: Permission[], settings: Settings = {}): Session {
  return {
    user: { id: id(90), displayName: 'Dr. Reyes', email: 'reyes@example.com' },
    platformAdmin: false,
    mustChangePassword: false,
    tenant: {
      id: id(91),
      name: 'Northgate Dental',
      slug: 'northgate',
      timeZone: 'Asia/Beirut',
      currency: 'USD',
      locale: 'en',
      country: 'LB',
      chartMode: settings.chartMode ?? 'surface',
      toothNotation: settings.toothNotation ?? 'fdi',
      chartOrientation: settings.chartOrientation ?? 'patient_right_on_right',
    },
    branch: null,
    branches: [],
    roleNames: [],
    permissions,
    idleTimeoutSeconds: 900,
  };
}

function tenantResponse(settings: Settings = {}) {
  return {
    id: id(91),
    name: 'Northgate Dental',
    slug: 'northgate',
    status: 'active' as const,
    timeZone: 'Asia/Beirut',
    currency: 'USD',
    locale: 'en',
    country: 'LB',
    chartMode: settings.chartMode ?? 'surface',
    toothNotation: settings.toothNotation ?? 'fdi',
    chartOrientation: settings.chartOrientation ?? 'patient_right_on_right',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderSection(permissions: Permission[], settings: Settings = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(sessionQueryOptions().queryKey, sessionWith(permissions, settings));
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ChartSettingsSection />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return client;
}

function radioFor(label: string): HTMLInputElement {
  const node = screen.getByText(label).closest('label');
  if (!node) throw new Error(`No card found for "${label}"`);
  const input = node.querySelector('input[type="radio"]');
  if (!input) throw new Error(`No radio found for "${label}"`);
  return input as HTMLInputElement;
}

function cardFor(label: string): HTMLElement {
  const node = screen.getByText(label).closest('label');
  if (!node) throw new Error(`No card found for "${label}"`);
  return node;
}

describe('ChartSettingsSection', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('patches the notation, refetches the session, and shows a toast', async () => {
    const json = (body: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const fetchMock = vi.fn((url: string, _init?: RequestInit) =>
      url.endsWith('/session')
        ? json(sessionWith(['tenant:read', 'tenant:write'], { toothNotation: 'universal' }))
        : json(tenantResponse({ toothNotation: 'universal' })),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderSection(['tenant:read', 'tenant:write']);

    fireEvent.click(radioFor('Universal notation'));

    await screen.findByText(/Universal notation enabled/);
    // The session query is actively observed by the section itself, so invalidating it also
    // triggers the real refetch (not just marks it stale).
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => call[0].endsWith('/session'))).toBe(true);
    });

    const patchCall = fetchMock.mock.calls.find((call) => call[0].endsWith('/tenant'))!;
    const [url, init] = patchCall;
    expect(url).toBe('/api/v1/tenant');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(typeof init?.body === 'string' ? init.body : '')).toEqual({
      toothNotation: 'universal',
    });
  });

  it('shows the cards disabled with a read-only note for a dentist', () => {
    renderSection(['visit:write']);

    expect(screen.getByText(/managed by the clinic owner/)).toBeTruthy();
    expect(radioFor('Simple tooth view')).toHaveProperty('disabled', true);
    expect(radioFor('Universal notation')).toHaveProperty('disabled', true);
    expect(radioFor("Patient's right on the left")).toHaveProperty('disabled', true);
  });

  it("doesn't patch when clicking the already-selected card", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderSection(['tenant:write']);

    fireEvent.click(radioFor('FDI notation'));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reflects each option in its live preview', () => {
    renderSection(['tenant:write']);

    // Chart detail: surface mode draws each surface as its own cell, simple mode doesn't.
    expect(cardFor('Simple tooth view').querySelectorAll('[data-surface]')).toHaveLength(0);
    expect(cardFor('Surface view').querySelectorAll('[data-surface]')).toHaveLength(20);

    // Notation: the brief's own example, FDI vs Universal for the same three teeth.
    expect(screen.getByText('#11')).toBeTruthy();
    expect(screen.getByText('#16')).toBeTruthy();
    expect(screen.getByText('#55')).toBeTruthy();
    expect(screen.getByText('#8')).toBeTruthy();
    expect(screen.getByText('#3')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();

    // Orientation: the R/L markers flip sides with the setting.
    const right = cardFor("Patient's right on the right").querySelector(
      '[data-orientation-preview]',
    );
    const left = cardFor("Patient's right on the left").querySelector('[data-orientation-preview]');
    expect(right?.querySelector('[data-mark="start"]')?.textContent).toBe('L');
    expect(right?.querySelector('[data-mark="end"]')?.textContent).toBe('R');
    expect(left?.querySelector('[data-mark="start"]')?.textContent).toBe('R');
    expect(left?.querySelector('[data-mark="end"]')?.textContent).toBe('L');
  });
});
