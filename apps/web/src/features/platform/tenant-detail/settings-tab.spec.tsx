import type { Tenant } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '@/lib/i18n';
import { ToastProvider } from '@/components/ui/toast';
import { platformKeys } from '@/features/platform/platform-api';
import { SettingsTab } from './settings-tab';

const tenant: Tenant = {
  id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f',
  name: 'Northgate Dental',
  slug: 'northgate',
  status: 'active',
  timeZone: 'Asia/Beirut',
  currency: 'USD',
  locale: 'en',
  country: 'LB',
  chartMode: 'surface',
  toothNotation: 'fdi',
  chartOrientation: 'patient_right_on_right',
  createdAt: '2026-09-26T10:00:00.000Z',
};

function renderSettings(locked: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(platformKeys.currencyLock(tenant.id), { locked, currency: 'USD' });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SettingsTab tenant={tenant} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('SettingsTab currency lock (H6)', () => {
  it('disables the currency once the clinic has recorded balances, and says why', () => {
    renderSettings(true);
    const currency = screen.getByLabelText<HTMLSelectElement>('Currency');
    expect(currency.disabled).toBe(true);
    const note = screen.getByText('Locked — this clinic has recorded balances in USD.');
    expect(currency.getAttribute('aria-describedby')).toBe(note.id);
  });

  it('keeps the currency editable for a clinic without ledger entries', () => {
    renderSettings(false);
    expect(screen.getByLabelText<HTMLSelectElement>('Currency').disabled).toBe(false);
    expect(screen.queryByText(/Locked/)).toBeNull();
  });
});
