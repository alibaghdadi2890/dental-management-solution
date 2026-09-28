import type { AuditEntry } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { todayIn } from '@/lib/format';
import {
  DENTIST_ID,
  FRONT_DESK_ID,
  id,
  json,
  mockApi,
  patient,
  problem,
  profileId,
  renderPanels,
} from '../patients.test-utils';

const RANA = patient(1, 'Rana Haddad', {
  dateOfBirth: '1990-05-01',
  email: 'rana@example.com',
  insurance: 'Allianz — Gold',
  medicalAlerts: ['Penicillin allergy', 'Latex'],
  primaryDentistId: profileId(DENTIST_ID),
});

const entry = (n: number, extra: Partial<AuditEntry>): AuditEntry => ({
  id: id(60 + n),
  actorUserId: FRONT_DESK_ID,
  actorKind: 'user',
  actorPlatformAdmin: false,
  action: 'patient.create',
  resourceType: 'patient',
  resourceId: RANA.id,
  before: null,
  after: null,
  reason: null,
  requestId: null,
  occurredAt: '2026-09-01T07:05:00.000Z',
  ...extra,
});

const AUDIT = {
  [RANA.id]: [
    entry(2, {
      action: 'patient.archive',
      reason: 'Moved away',
      occurredAt: '2026-09-02T08:00:00.000Z',
    }),
    entry(1, { actorKind: 'job', actorUserId: null, action: 'ledger_entry.repoint' }),
    entry(0, {}),
  ],
};

const quickView = () => screen.findByRole('complementary', { name: 'Rana Haddad' });

describe('QuickViewPanel', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the details, alerts and the open balance', async () => {
    mockApi({
      patients: [RANA],
      balances: { [RANA.id]: [{ amount: '250.00', currency: 'USD' }] },
    });
    renderPanels({ url: `/?panel=quick:${RANA.id}` });
    const aside = await quickView();
    expect(within(aside).getByText('P-000001')).toBeTruthy();
    expect(within(aside).getByText(/Female/)).toBeTruthy();
    expect(within(aside).getByText('03 123 456')).toBeTruthy();
    expect(within(aside).getByText('1 May 1990')).toBeTruthy();
    expect(within(aside).getByText('rana@example.com')).toBeTruthy();
    expect(within(aside).getByText('Allianz — Gold')).toBeTruthy();
    const alerts = within(aside).getByRole('list', { name: 'Medical alerts' });
    expect(
      within(alerts)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Penicillin allergy', 'Latex']);
    await waitFor(() => {
      expect(within(aside).getByText('Dr. Ana Reyes')).toBeTruthy();
    });
    const balance = await within(aside).findByText('$250');
    expect(balance.className).toContain('text-danger');
  });

  it('reads "—" for no balance, and has no Open balance without payment:read', async () => {
    mockApi({ patients: [RANA] });
    renderPanels({ url: `/?panel=quick:${RANA.id}` });
    const aside = await quickView();
    expect(within(aside).getByText('Open balance')).toBeTruthy();
    cleanup();

    mockApi({ patients: [RANA] });
    renderPanels({ url: `/?panel=quick:${RANA.id}`, permissions: ['patient:read'] });
    const other = await quickView();
    expect(within(other).queryByText('Open balance')).toBeNull();
    expect(within(other).queryByRole('button', { name: 'Edit details' })).toBeNull();
  });

  it('lists every non-zero balance, tenant currency first, even when that one is zero', async () => {
    mockApi({
      patients: [RANA],
      balances: {
        [RANA.id]: [
          { amount: '40.00', currency: 'EUR' },
          { amount: '0.00', currency: 'USD' },
        ],
      },
    });
    renderPanels({ url: `/?panel=quick:${RANA.id}` });
    const aside = await quickView();
    expect((await within(aside).findByText('€40')).className).toContain('text-danger');
  });

  it('says so when the balance fails to load', async () => {
    mockApi({
      patients: [RANA],
      get: (path) => (path.endsWith('/balance') ? problem(500, 'internal') : undefined),
    });
    renderPanels({ url: `/?panel=quick:${RANA.id}` });
    const aside = await quickView();
    expect(await within(aside).findByText('Couldn’t load the balance')).toBeTruthy();
  });

  it('reads a one-year-old as "1 yr"', async () => {
    const [y = '', m = '', d = ''] = todayIn('Asia/Beirut').split('-');
    const dob = `${String(Number(y) - 1)}-${m}-${m === '02' && d === '29' ? '28' : d}`;
    mockApi({ patients: [{ ...RANA, dateOfBirth: dob }] });
    renderPanels({ url: `/?panel=quick:${RANA.id}` });
    const aside = await quickView();
    expect(within(aside).getByText(/· 1 yr$/)).toBeTruthy();
  });

  it('pages the activity with Show more', async () => {
    const [first, second, third] = AUDIT[RANA.id] ?? [];
    mockApi({
      patients: [RANA],
      get: (path) => {
        if (!path.startsWith('/audit')) return undefined;
        return path.includes('cursor=c2')
          ? json({ items: [third], nextCursor: null })
          : json({ items: [first, second], nextCursor: 'c2' });
      },
    });
    renderPanels({ url: `/?panel=quick:${RANA.id}` });
    const aside = await quickView();
    const activity = within(aside).getByRole('region', { name: 'Activity' });
    expect(await within(activity).findAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(within(activity).getByRole('button', { name: 'Show more' }));
    await waitFor(() => {
      expect(within(activity).getAllByRole('listitem')).toHaveLength(3);
    });
    expect(within(activity).queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('keeps the entries shown when Show more fails, with an inline retry', async () => {
    const [first, second, third] = AUDIT[RANA.id] ?? [];
    let failMore = true;
    mockApi({
      patients: [RANA],
      get: (path) => {
        if (!path.startsWith('/audit')) return undefined;
        if (!path.includes('cursor=c2')) return json({ items: [first, second], nextCursor: 'c2' });
        return failMore ? problem(500, 'internal') : json({ items: [third], nextCursor: null });
      },
    });
    renderPanels({ url: `/?panel=quick:${RANA.id}` });
    const aside = await quickView();
    const activity = within(aside).getByRole('region', { name: 'Activity' });
    expect(await within(activity).findAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(within(activity).getByRole('button', { name: 'Show more' }));
    expect(await within(activity).findByText("Couldn't load more activity.")).toBeTruthy();
    expect(within(activity).getAllByRole('listitem')).toHaveLength(2);
    expect(within(activity).queryByText("Couldn't load the activity.")).toBeNull();

    failMore = false;
    fireEvent.click(within(activity).getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(within(activity).getAllByRole('listitem')).toHaveLength(3);
    });
    expect(within(activity).queryByText("Couldn't load more activity.")).toBeNull();
  });

  it('shows the activity with audit:read, naming the actor, the system and the reason', async () => {
    mockApi({ patients: [RANA], audit: AUDIT });
    renderPanels({ url: `/?panel=quick:${RANA.id}` });
    const aside = await quickView();
    const activity = within(aside).getByRole('region', { name: 'Activity' });
    const items = await within(activity).findAllByRole('listitem');
    expect(items.map((item) => item.firstElementChild?.nextSibling?.textContent)).toEqual([
      'Patient archived',
      'Balance moved from a merged record',
      'Patient registered',
    ]);
    await waitFor(() => {
      expect(items[0]?.textContent).toContain('2 Sep 2026, 11:00 · Jamie Ortiz');
    });
    expect(items[0]?.textContent).toContain('Reason: Moved away');
    expect(items[1]?.textContent).toContain('· System');
  });

  it('has no activity timeline without audit:read', async () => {
    const fetchMock = mockApi({ patients: [RANA], audit: AUDIT });
    renderPanels({
      url: `/?panel=quick:${RANA.id}`,
      permissions: ['patient:read', 'patient:write', 'payment:read'],
    });
    const aside = await quickView();
    expect(within(aside).queryByText('Activity')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/v1/audit'))).toBe(false);
  });

  it('opens the edit panel from Edit details', async () => {
    mockApi({ patients: [RANA] });
    const router = renderPanels({ url: `/?panel=quick:${RANA.id}` });
    const aside = await quickView();
    fireEvent.click(within(aside).getByRole('button', { name: 'Edit details' }));
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ panel: `edit:${RANA.id}` });
    });
    expect(await screen.findByRole('complementary', { name: 'Rana Haddad' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });

  it('opens the record from Open record', async () => {
    mockApi({ patients: [RANA] });
    const router = renderPanels({ url: `/?panel=quick:${RANA.id}`, permissions: ['patient:read'] });
    const aside = await quickView();
    expect(within(aside).queryByRole('button', { name: 'Edit details' })).toBeNull();
    fireEvent.click(within(aside).getByRole('button', { name: 'Open record' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/patients/${RANA.id}`);
    });
  });

  it('shows not found for an unknown patient, and closes', async () => {
    mockApi();
    const router = renderPanels({ url: `/?panel=quick:${id(99)}` });
    const aside = await screen.findByRole('complementary', { name: 'Patient not found' });
    fireEvent.click(within(aside).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(router.state.location.search).not.toHaveProperty('panel');
    });
  });
});
