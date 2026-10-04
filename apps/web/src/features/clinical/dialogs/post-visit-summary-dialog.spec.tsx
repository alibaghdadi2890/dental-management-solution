import type { Permission, Visit, VisitFinancialSummary } from '@dcm/contracts';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_PERMISSIONS,
  json,
  mockApi,
  type MockApi,
  problem,
  renderRecord,
} from '@/features/patients/patients.test-utils';
import { todayIn } from '@/lib/format';
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
  payments: [],
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
  payments: [],
};

/** The record as the workspace leaves it after Complete: `postVisit` in the entry's state. */
async function arriveAfterComplete(
  completed: Visit,
  summary: VisitFinancialSummary | Promise<VisitFinancialSummary>,
  permissions: Permission[] = ALL_PERMISSIONS,
  mutation?: MockApi['mutation'],
) {
  const fetchMock = mockApi({
    patients: [RANA],
    ...(mutation ? { mutation } : {}),
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

/** The same visit, completed on the tenant's today: its discount can still be set at checkout. */
const TODAYS: Visit = { ...COMPLETED, localDate: todayIn('Asia/Beirut') };
const WITH_DISCOUNT: Permission[] = [...ALL_PERMISSIONS, 'visit:discount'];

/** The figure beside a label. */
const figureOf = (scope: HTMLElement, label: string) =>
  within(scope).getByText(label).closest('div')?.querySelector('dd')?.textContent;

describe('PostVisitSummaryDialog', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows what is owed, from the API, in danger, with Done and Record payment', async () => {
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

    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Record payment' })).toBeTruthy();
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

  it('shows no footer action until the figures are in', async () => {
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
    expect(await within(dialog).findByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it("hands focus to the patient's name when it closes", async () => {
    await arriveAfterComplete(COMPLETED, OWING);
    const dialog = await screen.findByRole('dialog', { name: 'Visit recorded' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Done' }));
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

  it('Record payment is the next step of the same dialog; Cancel comes back to the figures', async () => {
    await arriveAfterComplete(COMPLETED, OWING);
    const dialog = await screen.findByRole('dialog', { name: 'Visit recorded' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Record payment' }));

    expect(
      await within(dialog).findByText(
        'Applied to this visit first, then to the oldest unpaid charge.',
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(dialog).queryByRole('region', { name: 'This visit' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Done' })).toBeNull();

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Cancel' }));
    expect(await within(dialog).findByRole('region', { name: 'This visit' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it('without payment:write: Done, a note that the front desk collects, and the invoice', async () => {
    await arriveAfterComplete(
      COMPLETED,
      OWING,
      ALL_PERMISSIONS.filter((permission) => permission !== 'payment:write'),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Visit recorded' });
    expect(await within(dialog).findByRole('button', { name: 'Done' })).toBeTruthy();
    expect(within(dialog).getByText('The front desk will collect the payment.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Print invoice' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Record payment' })).toBeNull();
  });

  it.each([
    ['without visit:discount', TODAYS, OWING, ALL_PERMISSIONS],
    ['after the day of the visit', COMPLETED, OWING, WITH_DISCOUNT],
    [
      'once the visit is paid',
      TODAYS,
      { ...OWING, visit: { ...OWING.visit, outstanding: '0.00' } },
      WITH_DISCOUNT,
    ],
  ])('offers no discount edit %s', async (_case, completed, summary, permissions) => {
    await arriveAfterComplete(completed, summary, permissions);
    const dialog = await screen.findByRole('dialog', { name: 'Visit recorded' });
    await within(dialog).findByRole('button', { name: 'Print invoice' });
    expect(within(dialog).queryByRole('button', { name: 'Edit the visit discount' })).toBeNull();
  });

  it('sets the discount at checkout: Apply waits for a change, then posts it', async () => {
    const posted: unknown[] = [];
    const { fetchMock } = await arriveAfterComplete(
      TODAYS,
      OWING,
      WITH_DISCOUNT,
      (method, path, body) => {
        if (method !== 'POST' || path !== `/visits/${VISIT_ID}/checkout-discount`) return undefined;
        posted.push(body);
        return json({ visit: TODAYS });
      },
    );
    const dialog = await screen.findByRole('dialog', { name: 'Visit recorded' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Edit the visit discount' }));

    const apply = within(dialog).getByRole('button', { name: 'Apply' });
    expect(apply).toHaveProperty('disabled', true);
    fireEvent.change(within(dialog).getByLabelText('Visit discount value'), {
      target: { value: '20' },
    });
    expect(within(dialog).getByText('$144')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Reason (optional)'), {
      target: { value: ' Family friend ' },
    });
    expect(apply).toHaveProperty('disabled', false);
    const reads = fetchMock.mock.calls.length;
    fireEvent.click(apply);

    await waitFor(() => {
      expect(within(dialog).queryByRole('button', { name: 'Apply' })).toBeNull();
    });
    expect(posted).toEqual([
      {
        expectedUpdatedAt: TODAYS.updatedAt,
        discount: { mode: 'percent', value: '20' },
        reason: 'Family friend',
      },
    ]);
    // The visit and its figures are read again.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(reads + 1);
  });

  it('shows why a checkout discount was refused and keeps the editor open', async () => {
    await arriveAfterComplete(TODAYS, OWING, WITH_DISCOUNT, (method, path) =>
      method === 'POST' && path.endsWith('/checkout-discount')
        ? problem(409, 'visit.checkout_closed')
        : undefined,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Visit recorded' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Edit the visit discount' }));
    fireEvent.change(within(dialog).getByLabelText('Visit discount value'), {
      target: { value: '5' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'The discount can only be set at checkout on the day of the visit.',
    );
    expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeTruthy();
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
