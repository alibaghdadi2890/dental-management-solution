import {
  addDays,
  type LabOrderSummary,
  type NextAppointmentRequest,
  type Permission,
} from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { sessionQueryOptions } from '@/features/auth/session';
import { chart, treatmentPlan, visit } from '@/features/clinical/workspace/workspace.test-utils';
import { id, json, problem, sessionWith } from '@/features/patients/patients.test-utils';
import { todayIn } from '@/lib/format';
import { NextAppointmentDialog } from './next-appointment-dialog';

const TODAY = todayIn('Asia/Beirut');
const THE_VISIT = visit({ localDate: TODAY });
const CROWN_PLAN = treatmentPlan(40, 'Zirconia crown', '16', { status: 'in_progress' });
const DONE_PLAN = treatmentPlan(42, 'Post and core', '16', { status: 'performed' });
const WITH_LABS: Permission[] = ['visit:read', 'visit:write', 'lab:read'];

function labOrder(extra: Partial<LabOrderSummary> = {}): LabOrderSummary {
  return {
    id: id(30),
    displayNumber: 7,
    patient: { id: THE_VISIT.patientId, fullName: 'Rana Haddad', displayNumber: 'P-000001' },
    dentistId: THE_VISIT.dentistId,
    dentistName: 'Dr. Ana Reyes',
    labId: id(31),
    labName: 'Cedar Lab',
    labPhone: null,
    branchId: THE_VISIT.branchId,
    visitId: THE_VISIT.id,
    appointment: null,
    status: 'at_lab',
    priority: 'normal',
    submission: 'physical',
    items: [
      {
        id: id(32),
        serviceId: null,
        description: 'Zirconia crown',
        unitPrice: null,
        turnaroundDays: null,
        quantity: 1,
        shade: 'A2',
        target: 'teeth',
        teeth: ['16'],
      },
    ],
    planIds: [CROWN_PLAN.id, DONE_PLAN.id],
    expectedDays: 7,
    sentOn: TODAY,
    expectedOn: addDays(TODAY, 7),
    promisedOn: addDays(TODAY, 7),
    receivedOn: null,
    firstReceivedOn: null,
    waitingSince: TODAY,
    tripCount: 1,
    label: null,
    cost: null,
    currency: 'USD',
    createdAt: `${TODAY}T09:00:00.000Z`,
    ...extra,
  };
}

function renderDialog(orders: LabOrderSummary[], permissions = WITH_LABS) {
  const fetchMock = vi.fn((url: string) => {
    const path = url.replace('/api/v1', '').split('?')[0];
    if (path === '/lab-orders/open') return Promise.resolve(json(orders));
    if (path?.endsWith('/appointments')) return Promise.resolve(json([]));
    return Promise.resolve(problem(404, 'not_found'));
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(sessionQueryOptions().queryKey, sessionWith(permissions));
  const onComplete = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <NextAppointmentDialog
        visit={THE_VISIT}
        chart={chart({ plans: [CROWN_PLAN, DONE_PLAN] })}
        patientName="Rana Haddad"
        completing={false}
        onBack={() => undefined}
        onComplete={onComplete}
      />
    </QueryClientProvider>,
  );
  return { onComplete, fetchMock };
}

/** What the dialog completed the visit with. */
const sentPayload = (onComplete: ReturnType<typeof vi.fn>) =>
  onComplete.mock.calls[0]?.[0] as NextAppointmentRequest | undefined;

const completeSend = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Complete visit · send to front desk' }));
};

describe('NextAppointmentDialog: lab work', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('offers fitting the lab work as its own reason, timed for when it is back', async () => {
    const { onComplete } = renderDialog([labOrder()]);

    const lab = await screen.findByRole('list', { name: 'Lab work' });
    const row = within(lab).getByRole('button', { name: /Fit zirconia crown/ });
    expect(row.getAttribute('data-reason')).toBe('lab_work');
    expect(row.textContent).toContain('L-000007');
    expect(row.textContent).toContain('Lab work expected');
    // The plan row stays the default: lab work is offered, never chosen for the dentist.
    expect(row.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(row);
    expect(row.getAttribute('aria-pressed')).toBe('true');
    completeSend();

    const payload = sentPayload(onComplete);
    expect(payload?.title).toMatch(/^Fit zirconia crown .*16$/);
    expect(payload).toMatchObject({
      kind: 'lab_work',
      // Only the plan items still open: the performed one would only warn later.
      planIds: [CROWN_PLAN.id],
      durationMin: 30,
      timing: 'custom',
      customDate: addDays(TODAY, 7),
    });
  });

  it('asks for the soonest appointment when the work has arrived', async () => {
    const { onComplete } = renderDialog([
      labOrder({ status: 'arrived', receivedOn: TODAY, expectedOn: TODAY }),
    ]);

    fireEvent.click(await screen.findByRole('button', { name: /Fit zirconia crown/ }));
    completeSend();

    expect(sentPayload(onComplete)).toMatchObject({
      kind: 'lab_work',
      timing: 'asap',
      customDate: null,
    });
  });

  it('is not offered without lab:read, and is never a follow-up kind chip', async () => {
    const { fetchMock } = renderDialog([labOrder()], ['visit:read', 'visit:write']);

    expect(await screen.findByRole('group', { name: 'Follow-up kind' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Lab work' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lab work fit' })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/lab-orders'))).toBe(false);
  });
});
