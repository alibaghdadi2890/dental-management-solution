import { fromCents, toCents, type Visit, type VisitDiscountInput } from '@dcm/contracts';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from '@/features/patients/patients.test-utils';
import { SAVE_DEBOUNCE_MS } from '../save-groups-store';
import {
  FRONT_DESK,
  mockWorkspace,
  renderWorkspace,
  sent,
  visit,
  VISIT_ID,
  visitService,
} from './workspace.test-utils';

const usd = (amount: string) => ({ amount, currency: 'USD' });
const DISCOUNT_PATH = `/visits/${VISIT_ID}/discount`;

/** $80 on #16, $120 − $20 on #16 and a $0 jaw-level check: a $180 subtotal. */
const SERVICES = [
  visitService(30, 'Composite filling', '16'),
  visitService(32, 'Zircon crown', '16', {
    base: usd('120.00'),
    discount: usd('20.00'),
    final: usd('100.00'),
  }),
  visitService(34, 'Examination', null, { base: usd('0.00'), final: usd('0.00') }),
];

/** A fake server that stores the discount (money isn't recomputed: the bar computes its own). */
function fakeVisit(initial: Visit = visit({ services: SERVICES })) {
  const state = { visit: initial };
  const fetchMock = mockWorkspace({
    visit: () => state.visit,
    mutation: (method, path, body) => {
      if (method === 'PATCH' && path === DISCOUNT_PATH) {
        const { mode, value } = body as VisitDiscountInput;
        state.visit = {
          ...state.visit,
          discountMode: mode,
          discountValue: fromCents(toCents(value)),
        };
        return json({ visit: state.visit });
      }
      const serviceId = /\/services\/([^/]+)$/.exec(path)?.[1];
      const service = state.visit.services.find((row) => row.id === serviceId);
      if (method === 'PATCH' && service) return json({ visit: state.visit, record: service });
      return undefined;
    },
  });
  return { state, fetchMock };
}

const bar = async () => {
  await screen.findByRole('group', { name: 'Upper arch' });
  return screen.getByRole('contentinfo', { name: 'Visit money' });
};

/** The value under one of the bar's labelled cells. */
const cell = (footer: HTMLElement, name: string) =>
  within(footer).getByRole('group', { name }).lastElementChild;

const discountInput = () => screen.getByRole('textbox', { name: 'Visit discount value' });

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
  });
}

describe('FinancialBar', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the services, the discount, its amount and the total, and counts the work', async () => {
    fakeVisit(visit({ services: SERVICES, discountMode: 'percent', discountValue: '10.00' }));
    renderWorkspace();
    const footer = await bar();
    expect(cell(footer, 'Services')?.textContent).toBe('$180');
    expect((discountInput() as HTMLInputElement).value).toBe('10');
    expect(
      within(footer).getByRole('button', { name: 'Percent' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(within(footer).getByRole('button', { name: 'Amount' }).textContent).toBe('$');
    const amount = cell(footer, 'Discount amount');
    expect(amount?.textContent).toBe('−$18');
    expect(amount?.className).toContain('text-danger');
    expect(cell(footer, 'Visit total')?.textContent).toBe('$162');
    expect(within(footer).getByText('3 services · 1 tooth')).toBeTruthy();
    expect(within(footer).queryByRole('alert')).toBeNull();
  });

  it('shows a zero discount amount muted', async () => {
    fakeVisit();
    renderWorkspace();
    const footer = await bar();
    const amount = cell(footer, 'Discount amount');
    expect(amount?.textContent).toBe('$0');
    expect(amount?.className).toContain('text-ink-muted');
  });

  it('keeps a 500 % discount as typed, caps the total and warns on a line of its own', async () => {
    const { fetchMock } = fakeVisit();
    renderWorkspace();
    const footer = await bar();
    expect(footer.className).toContain('flex-wrap');

    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(discountInput(), { target: { value: '500' } });
    const warning = within(footer).getByRole('alert');
    expect(warning.textContent).toBe('Discount exceeds the subtotal — capped at 100%');
    expect(warning.className).toContain('order-9');
    expect(warning.className).toContain('flex-[1_0_100%]');
    expect(cell(footer, 'Discount amount')?.textContent).toBe('−$180');
    expect(cell(footer, 'Visit total')?.textContent).toBe('$0');

    await settle();
    expect(sent(fetchMock, 'PATCH', DISCOUNT_PATH)).toEqual({ mode: 'percent', value: '500' });
    expect((discountInput() as HTMLInputElement).value).toBe('500');
    expect(within(footer).getByRole('alert')).toBeTruthy();
  });

  it('caps a $500 amount discount at the subtotal', async () => {
    const { fetchMock } = fakeVisit();
    renderWorkspace();
    const footer = await bar();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(within(footer).getByRole('button', { name: 'Amount' }));
    fireEvent.change(discountInput(), { target: { value: '500' } });
    expect(within(footer).getByRole('alert')).toBeTruthy();
    expect(cell(footer, 'Discount amount')?.textContent).toBe('−$180');
    expect(cell(footer, 'Visit total')?.textContent).toBe('$0');
    await settle();
    expect(sent(fetchMock, 'PATCH', DISCOUNT_PATH)).toEqual({ mode: 'amount', value: '500' });

    fireEvent.change(discountInput(), { target: { value: '30' } });
    expect(within(footer).queryByRole('alert')).toBeNull();
    expect(cell(footer, 'Visit total')?.textContent).toBe('$150');
  });

  it('strips non-numeric input, so a negative cannot be typed', async () => {
    fakeVisit();
    renderWorkspace();
    await bar();
    fireEvent.change(discountInput(), { target: { value: '1a2.5x%' } });
    expect((discountInput() as HTMLInputElement).value).toBe('12.5');
    fireEvent.change(discountInput(), { target: { value: '-15' } });
    expect((discountInput() as HTMLInputElement).value).toBe('15');
  });

  it('previews a price being typed in the tooth panel before it is saved', async () => {
    fakeVisit();
    renderWorkspace();
    const footer = await bar();
    const chart = screen.getByRole('region', { name: 'Dental chart' });
    fireEvent.click(within(chart).getByRole('button', { name: /^#16 · / }));
    const [base] = within(
      screen.getByRole('complementary', { name: 'Selected tooth' }),
    ).getAllByRole('textbox', { name: 'Base price' });
    if (!base) throw new Error('no Base price input');

    fireEvent.change(base, { target: { value: '100' } });
    expect(cell(footer, 'Services')?.textContent).toBe('$200');
    expect(cell(footer, 'Visit total')?.textContent).toBe('$200');
  });

  it('Save draft only says the visit stays open', async () => {
    const { fetchMock } = fakeVisit();
    renderWorkspace();
    const footer = await bar();
    const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method !== undefined);
    const before = writes().length;
    fireEvent.click(within(footer).getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft saved')).toBeTruthy();
    expect(
      screen.getByText('Visit stays open — nothing has been recorded to history yet.'),
    ).toBeTruthy();
    expect(writes().length).toBe(before);
  });

  it('is read-only for front desk: the discount is shown, nothing can be changed', async () => {
    fakeVisit(visit({ services: SERVICES, discountMode: 'amount', discountValue: '12.50' }));
    renderWorkspace({ permissions: FRONT_DESK });
    const footer = await bar();
    expect((discountInput() as HTMLInputElement).value).toBe('12.5');
    expect(discountInput().hasAttribute('readonly')).toBe(true);
    expect(within(footer).getByRole('button', { name: 'Percent' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(within(footer).getByRole('button', { name: 'Save draft' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(within(footer).getByRole('button', { name: 'Review & complete' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(cell(footer, 'Visit total')?.textContent).toBe('$167.50');
  });
});
