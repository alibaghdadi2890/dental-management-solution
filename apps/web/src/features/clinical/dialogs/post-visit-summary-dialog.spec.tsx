import type { Permission, Visit, VisitFinancialSummary } from '@dcm/contracts';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_PERMISSIONS,
  json,
  mockApi,
  renderRecord,
} from '@/features/patients/patients.test-utils';
import { RANA, visit, VISIT_ID, visitService } from '../workspace/workspace.test-utils';

const usd = (amount: string) => ({ amount, currency: 'USD' });

const COMPLETED: Visit = visit({
  status: 'completed',
  completedAt: '2026-09-04T09:13:00.000Z',
  durationMinutes: 13,
  discountValue: '10.00',
  services: [
    visitService(20, 'Composite filling', '26'),
    visitService(22, 'Fissure sealant', '16', { base: usd('40.00'), final: usd('40.00') }),
    visitService(24, 'Scaling', null, { base: usd('60.00'), final: usd('60.00') }),
  ],
  money: { subtotal: '180.00', discount: '18.00', total: '162.00', capped: false },
});

const OWING: VisitFinancialSummary = {
  visitId: VISIT_ID,
  currency: 'USD',
  visit: { total: '162.00', paid: '0.00', outstanding: '162.00' },
  previous: '50.00',
  totalOutstanding: '212.00',
};

/** An examination (W20): no charge, and nothing owed from before. */
const EXAMINATION: Visit = {
  ...COMPLETED,
  discountValue: '0.00',
  services: [],
  money: { subtotal: '0.00', discount: '0.00', total: '0.00', capped: false },
};
const CLEAR: VisitFinancialSummary = {
  visitId: VISIT_ID,
  currency: 'USD',
  visit: { total: '0.00', paid: '0.00', outstanding: '0.00' },
  previous: '0.00',
  totalOutstanding: '0.00',
};

/** The record as the workspace leaves it after Complete: `postVisit` in the entry's state. */
async function arriveAfterComplete(
  completed: Visit,
  summary: VisitFinancialSummary | Promise<VisitFinancialSummary>,
  permissions: Permission[] = ALL_PERMISSIONS,
) {
  const fetchMock = mockApi({
    patients: [RANA],
    get: (path) => {
      if (path === `/visits/${VISIT_ID}`) return json(completed);
      if (path === `/billing/visits/${VISIT_ID}/summary`)
        return Promise.resolve(summary).then(json);
      return undefined;
    },
  });
  const rendered = renderRecord({ url: `/patients/${RANA.id}`, permissions });
  await screen.findByRole('heading', { level: 1, name: 'Rana Haddad' });
  await act(() =>
    rendered.router.navigate({
      to: '/patients/$patientId',
      params: { patientId: RANA.id },
      replace: true,
      state: { postVisit: VISIT_ID },
    }),
  );
  return { ...rendered, fetchMock };
}

/** The figure beside a label. */
const figureOf = (scope: HTMLElement, label: string) =>
  within(scope).getByText(label).closest('div')?.querySelector('dd')?.textContent;

describe('PostVisitSummaryDialog', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows what is owed, from the API, in danger, with Pay later and no Record payment', async () => {
    await arriveAfterComplete(COMPLETED, OWING);
    const dialog = await screen.findByRole('dialog', { name: 'Visit recorded' });
    expect(await within(dialog).findByText('4 Sep 2026 · 13 min · 3 services')).toBeTruthy();
    expect(await within(dialog).findByText('Unpaid')).toBeTruthy();

    const thisVisit = within(dialog).getByRole('region', { name: 'This visit' });
    expect(figureOf(thisVisit, 'Services')).toBe('$180');
    expect(figureOf(thisVisit, 'Discount')).toBe('−$18');
    expect(figureOf(thisVisit, 'Visit total')).toBe('$162');
    expect(figureOf(thisVisit, 'Paid during this visit')).toBe('$0');
    expect(figureOf(thisVisit, 'Outstanding for this visit')).toBe('$162');
    const previous = within(dialog).getByRole('region', { name: 'Previous visits' });
    expect(figureOf(previous, 'Outstanding from earlier visits')).toBe('$50');

    const total = within(dialog).getByText('$212');
    expect(total.className).toContain('text-danger');
    expect(within(dialog).getByText('This visit plus everything unpaid before it')).toBeTruthy();
    expect(within(dialog).queryByText(/Nothing left to collect/)).toBeNull();

    expect(within(dialog).getByRole('button', { name: 'Pay later' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Done' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /Record payment/ })).toBeNull();
  });

  it('shows a settled account in success, Paid in full, with Done', async () => {
    await arriveAfterComplete(EXAMINATION, CLEAR);
    const dialog = await screen.findByRole('dialog', { name: 'Visit recorded' });
    expect(await within(dialog).findByText('Paid in full')).toBeTruthy();
    expect(within(dialog).getByText('4 Sep 2026 · 13 min · 0 services')).toBeTruthy();
    const thisVisit = within(dialog).getByRole('region', { name: 'This visit' });
    expect(figureOf(thisVisit, 'Visit total')).toBe('$0');

    const total = figureOf(dialog, 'Total outstanding');
    expect(total).toBe('$0');
    expect(
      within(dialog).getByText('Total outstanding').closest('dl')?.querySelector('dd')?.className,
    ).toContain('text-success');
    expect(
      within(dialog).getByText("Nothing left to collect. The patient's account is fully settled."),
    ).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Pay later' })).toBeNull();
  });

  it('closes for good: the state is cleared, so it never opens again', async () => {
    const { router } = await arriveAfterComplete(EXAMINATION, CLEAR);
    const dialog = await screen.findByRole('dialog', { name: 'Visit recorded' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(router.state.location.state.postVisit).toBeUndefined();
    expect(router.state.location.pathname).toBe(`/patients/${RANA.id}`);
  });

  it('shows no footer action until the figures are in, so Done never turns into Pay later', async () => {
    let answer: (summary: VisitFinancialSummary) => void = () => undefined;
    await arriveAfterComplete(
      COMPLETED,
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Visit recorded' });
    expect(await within(dialog).findByText('4 Sep 2026 · 13 min · 3 services')).toBeTruthy();
    expect(within(dialog).queryByRole('button')).toBeNull();

    answer(OWING);
    expect(await within(dialog).findByRole('button', { name: 'Pay later' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Done' })).toBeNull();
  });

  it("hands focus to the patient's name when it closes", async () => {
    await arriveAfterComplete(COMPLETED, OWING);
    const dialog = await screen.findByRole('dialog', { name: 'Visit recorded' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Pay later' }));
    const heading = screen.getByRole('heading', { level: 1, name: 'Rana Haddad' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc closes it too', async () => {
    const { router } = await arriveAfterComplete(COMPLETED, OWING);
    const dialog = await screen.findByRole('dialog', { name: 'Visit recorded' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(router.state.location.state.postVisit).toBeUndefined();
  });

  it('is not shown without payment:read: a toast says the visit was recorded, once', async () => {
    const { fetchMock, router } = await arriveAfterComplete(
      COMPLETED,
      OWING,
      ALL_PERMISSIONS.filter((permission) => permission !== 'payment:read'),
    );
    expect(await screen.findByText('Visit recorded')).toBeTruthy();
    await waitFor(() => {
      expect(router.state.location.state.postVisit).toBeUndefined();
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.getAllByText('Visit recorded')).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      fetchMock.mock.calls.some(([url]) => url.includes(`/billing/visits/${VISIT_ID}/summary`)),
    ).toBe(false);
  });
});
