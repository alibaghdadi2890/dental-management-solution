import { fromCents, toCents, type Visit, type VisitDiscountInput } from '@dcm/contracts';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, problem } from '@/features/patients/patients.test-utils';
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

/** The Composite filling's price route. */
const SERVICE_PATH = `/visits/${VISIT_ID}/services/${SERVICES[0]?.id ?? ''}`;

/** A fake server that stores the discount and the prices (money isn't recomputed: the bar computes
 * its own). `prices`: `apply` stores a price edit, `stale` answers with the service unchanged (a
 * cache that hasn't caught up), `fail` answers 500. */
function fakeVisit(
  initial: Visit = visit({ services: SERVICES }),
  prices: 'apply' | 'stale' | 'fail' = 'apply',
) {
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
      if (method !== 'PATCH' || !service) return undefined;
      if (prices === 'fail') return problem(500, 'internal');
      if (prices === 'stale') return json({ visit: state.visit, record: service });
      const { baseAmount, discountAmount } = body as { baseAmount: string; discountAmount: string };
      const base = toCents(baseAmount);
      const discount = toCents(discountAmount);
      const updated = {
        ...service,
        base: usd(fromCents(base)),
        discount: usd(fromCents(discount)),
        final: usd(fromCents(base - discount)),
      };
      state.visit = {
        ...state.visit,
        services: state.visit.services.map((row) => (row.id === service.id ? updated : row)),
      };
      return json({ visit: state.visit, record: updated });
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

const aside = () => screen.getByRole('complementary', { name: 'Selected tooth' });

/** Selects #16 and returns its first service's Base price input ($80, Composite filling). */
async function baseInput(): Promise<HTMLInputElement> {
  const chart = screen.getByRole('region', { name: 'Dental chart' });
  fireEvent.click(within(chart).getByRole('button', { name: /^#16 · / }));
  const [base] = await within(aside()).findAllByRole('textbox', { name: 'Base price' });
  if (!(base instanceof HTMLInputElement)) throw new Error('no Base price input');
  return base;
}

const discountInput = () =>
  screen.getByRole<HTMLInputElement>('textbox', { name: 'Visit discount value' });

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
    expect(discountInput().value).toBe('10');
    const modes = within(footer).getByRole('radiogroup', { name: 'Discount type' });
    expect(within(modes).getByRole('radio', { name: 'Percent' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(within(modes).getByRole('radio', { name: 'Amount' }).textContent).toBe('$');
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
    expect(discountInput().value).toBe('500');
    expect(within(footer).getByRole('alert')).toBeTruthy();
  });

  it('caps a $500 amount discount at the subtotal', async () => {
    const { fetchMock } = fakeVisit();
    renderWorkspace();
    const footer = await bar();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(within(footer).getByRole('radio', { name: 'Amount' }));
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

  it('switching the mode keeps the raw value and saves it with the new mode', async () => {
    const { fetchMock } = fakeVisit();
    renderWorkspace();
    const footer = await bar();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(discountInput(), { target: { value: '50' } });
    expect(cell(footer, 'Visit total')?.textContent).toBe('$90');

    const percent = within(footer).getByRole('radio', { name: 'Percent' });
    percent.focus();
    // Arrow keys move the choice, as in any radio group.
    fireEvent.keyDown(percent, { key: 'ArrowRight' });
    const amount = within(footer).getByRole('radio', { name: 'Amount' });
    expect(amount.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(amount);
    expect(amount.tabIndex).toBe(0);
    expect(percent.tabIndex).toBe(-1);
    expect(discountInput().value).toBe('50');
    expect(cell(footer, 'Visit total')?.textContent).toBe('$130');

    await settle();
    expect(sent(fetchMock, 'PATCH', DISCOUNT_PATH)).toEqual({ mode: 'amount', value: '50' });
    fireEvent.keyDown(amount, { key: 'ArrowLeft' });
    expect(percent.getAttribute('aria-checked')).toBe('true');
  });

  it('keeps what was typed when the save comes back written another way', async () => {
    const { fetchMock } = fakeVisit();
    renderWorkspace();
    await bar();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(discountInput(), { target: { value: '10.' } });
    await settle();
    expect(sent(fetchMock, 'PATCH', DISCOUNT_PATH)).toEqual({ mode: 'percent', value: '10' });
    // The answer stores 10.00: the field still reads what was typed, so the next digit appends.
    expect(discountInput().value).toBe('10.');
    fireEvent.change(discountInput(), { target: { value: discountInput().value + '5' } });
    expect(discountInput().value).toBe('10.5');
    await settle();
    expect(sent(fetchMock, 'PATCH', DISCOUNT_PATH)).toEqual({ mode: 'percent', value: '10.5' });
    expect(discountInput().value).toBe('10.5');

    fireEvent.change(discountInput(), { target: { value: '0.' } });
    await settle();
    expect(discountInput().value).toBe('0.');
  });

  it('keeps a typed price the same way', async () => {
    const { fetchMock } = fakeVisit();
    renderWorkspace();
    await bar();
    const base = await baseInput();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(base, { target: { value: '100.' } });
    await settle();
    expect(sent(fetchMock, 'PATCH', SERVICE_PATH)).toEqual({
      baseAmount: '100',
      discountAmount: '0.00',
    });
    expect(base.value).toBe('100.');
    fireEvent.change(base, { target: { value: base.value + '5' } });
    expect(base.value).toBe('100.5');
  });

  it('strips non-numeric input, so a negative cannot be typed', async () => {
    fakeVisit();
    renderWorkspace();
    await bar();
    fireEvent.change(discountInput(), { target: { value: '1a2.5x%' } });
    expect(discountInput().value).toBe('12.5');
    fireEvent.change(discountInput(), { target: { value: '-15' } });
    expect(discountInput().value).toBe('15');
  });

  it('previews a price being typed in the tooth panel before it is saved', async () => {
    fakeVisit();
    renderWorkspace();
    const footer = await bar();
    const base = await baseInput();

    fireEvent.change(base, { target: { value: '100' } });
    expect(cell(footer, 'Services')?.textContent).toBe('$200');
    expect(cell(footer, 'Visit total')?.textContent).toBe('$200');
  });

  it('keeps previewing a saved price until the cached visit catches up', async () => {
    fakeVisit(undefined, 'stale');
    renderWorkspace();
    const footer = await bar();
    const base = await baseInput();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(base, { target: { value: '100' } });
    await settle();
    expect(await within(aside()).findByText('Saved just now')).toBeTruthy();
    expect(cell(footer, 'Visit total')?.textContent).toBe('$200');
  });

  it('keeps previewing a price whose save failed', async () => {
    fakeVisit(undefined, 'fail');
    renderWorkspace();
    const footer = await bar();
    const base = await baseInput();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(base, { target: { value: '100' } });
    await settle();
    expect(
      await within(aside()).findByRole('button', { name: 'Failed to save — retry' }),
    ).toBeTruthy();
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
    expect(discountInput().value).toBe('12.5');
    expect(discountInput().hasAttribute('readonly')).toBe(true);
    expect(within(footer).getByRole('radio', { name: 'Percent' })).toHaveProperty('disabled', true);
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
