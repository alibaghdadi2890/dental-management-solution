import type { PlanSession, ServiceItem, ToothCode } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { id } from '@/features/patients/patients.test-utils';
import {
  chart,
  FRONT_DESK,
  mockWorkspace,
  OLDER_VISIT_ID,
  pickRowAction,
  renderWorkspace,
  sent,
  serviceItem,
  treatmentPlan,
  visit,
  VISIT_ID,
  visitService,
} from './workspace.test-utils';

const SERVICES: ServiceItem[] = [
  serviceItem(40, 'Composite filling'),
  serviceItem(42, 'Polishing', { chargeUnit: 'per_mouth', category: 'Periodontal' }),
  serviceItem(44, 'Whitening', { chargeUnit: 'per_jaw', category: 'Cosmetic' }),
];

/** A crown on #46, a whitening of the upper jaw and a polishing of the whole mouth today; a
 * whitening planned for the lower jaw. */
const mockLevels = () =>
  mockWorkspace({
    visit: () =>
      visit({
        services: [
          visitService(50, 'Zircon crown', '46'),
          visitService(52, 'Whitening', null, { chargeUnit: 'per_jaw', jaw: 'upper' }),
          visitService(54, 'Polishing', null),
        ],
        money: { subtotal: '240.00', discount: '0.00', total: '240.00', capped: false },
      }),
    chart: () =>
      chart({
        plans: [treatmentPlan(20, 'Whitening', null, { chargeUnit: 'per_jaw', jaw: 'lower' })],
      }),
    services: SERVICES,
  });

const chartCard = async () => {
  await screen.findByRole('group', { name: 'Upper arch' });
  return within(screen.getByRole('region', { name: 'Dental chart' }));
};
const panel = () => within(screen.getByRole('complementary', { name: 'Selected tooth' }));

describe('Today’s services and the chart’s jaw and whole-mouth areas', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists every service of the visit, whatever its level, with the count and subtotal', async () => {
    mockLevels();
    renderWorkspace();
    await chartCard();
    const card = screen.getByRole('region', { name: "Today's services" });
    expect(within(card).getByText('3 services')).toBeTruthy();
    expect(within(card).getByText('$240')).toBeTruthy();
    expect(
      within(card)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual(['#46Zircon crown$80', 'Upper jawWhitening$80', 'Whole mouthPolishing$80']);

    // A row's target selects it on the chart.
    fireEvent.click(within(card).getByRole('button', { name: 'Upper jaw' }));
    expect(panel().getByRole('heading', { name: 'Upper jaw' })).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: '#46' }));
    expect(panel().getByRole('heading', { name: '#46' })).toBeTruthy();
  });

  it('is absent while the visit has no service and the patient no unfinished one', async () => {
    mockWorkspace();
    renderWorkspace();
    await chartCard();
    expect(screen.queryByRole('region', { name: "Today's services" })).toBeNull();
  });

  it('puts unfinished services first, and offers each what its state allows', async () => {
    const earlier = { visitId: OLDER_VISIT_ID, date: '2026-08-21', note: null };
    const today = { visitId: VISIT_ID, date: '2026-09-04', note: null };
    const unfinished = (n: number, name: string, tooth: ToothCode, sessions: PlanSession[]) =>
      treatmentPlan(n, name, tooth, {
        status: 'in_progress',
        recordedInVisitId: sessions[0] === today ? VISIT_ID : OLDER_VISIT_ID,
        sessions,
      });
    const fetchMock = mockWorkspace({
      visit: () =>
        visit({
          services: [visitService(50, 'Composite filling', '14')],
          money: { subtotal: '80.00', discount: '0.00', total: '80.00', capped: false },
          // Answered already: the popup is another spec's.
          unfinishedAnsweredAt: '2026-09-04T09:01:00.000Z',
        }),
      chart: () =>
        chart({
          plans: [
            unfinished(20, 'Root canal', '36', [earlier]),
            unfinished(22, 'Zircon crown', '46', [earlier, today]),
            unfinished(24, 'Inlay', '26', [today]),
            treatmentPlan(26, 'Sealant', '16'),
          ],
        }),
    });
    renderWorkspace();
    await chartCard();
    const card = within(screen.getByRole('region', { name: "Today's services" }));

    // Waiting from an earlier visit: first, with no Complete until it is continued.
    expect(card.getByText('To continue · 1')).toBeTruthy();
    const [waiting, service, continued] = card.getAllByRole('listitem');
    expect(waiting?.textContent).toBe('#36Root canalStarted 21 Aug 2026 · 1 visitNot finished$400');
    expect(service?.textContent).toBe('#14Composite filling$80');
    expect(continued?.textContent).toContain('2 visits');
    expect(card.getAllByRole('button', { name: /^Complete: / })).toHaveLength(2);
    // Only what the visit charges is counted; the rest is carried forward.
    expect(card.getByText('1 service')).toBeTruthy();
    expect(card.getByText(/^Carried forward/).textContent).toBe('Carried forward $1,200');

    await pickRowAction(card, 'Root canal', 'Continue');
    await waitFor(() => {
      expect(sent(fetchMock, 'PUT', `/visits/${VISIT_ID}/plans/${id(20)}/session`)).toEqual({
        note: null,
      });
    });
    await pickRowAction(card, 'Zircon crown', 'Not today');
    await waitFor(() => {
      expect(sent(fetchMock, 'DELETE', `/visits/${VISIT_ID}/plans/${id(22)}/session`)).toBeNull();
    });
    // First added in this visit: removed, not postponed.
    await pickRowAction(card, 'Inlay', 'Remove');
    await waitFor(() => {
      expect(sent(fetchMock, 'DELETE', `/visits/${VISIT_ID}/plans/${id(24)}/session`)).toBeNull();
    });

    fireEvent.click(card.getByRole('button', { name: 'Complete: Zircon crown' }));
    await waitFor(() => {
      expect(sent(fetchMock, 'POST', `/visits/${VISIT_ID}/plans/${id(22)}/perform`)).toBeNull();
    });
    await pickRowAction(card, 'Composite filling', 'Not finished');
    await waitFor(() => {
      expect(
        sent(fetchMock, 'POST', `/visits/${VISIT_ID}/services/${id(50)}/unfinished`),
      ).toBeNull();
    });
  });

  it('the chart selects a jaw or the whole mouth; the panel shows that level and its tabs', async () => {
    mockLevels();
    renderWorkspace();
    const card = await chartCard();
    const mouth = card.getByRole('button', { name: /^Whole mouth/ });
    expect(mouth.getAttribute('aria-pressed')).toBe('false');
    expect(within(mouth).getByText('1')).toBeTruthy();

    fireEvent.click(mouth);
    expect(mouth.getAttribute('aria-pressed')).toBe('true');
    expect(panel().getByRole('heading', { name: 'Whole mouth' })).toBeTruthy();
    expect(panel().getByText('Polishing')).toBeTruthy();
    expect(panel().getByLabelText('Base price')).toBeTruthy();
    expect(panel().queryByText('Whitening')).toBeNull();

    // The panel's tabs move between the three levels.
    fireEvent.click(panel().getByRole('button', { name: 'Lower jaw' }));
    expect(card.getByRole('button', { name: /^Lower jaw/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(panel().getByRole('button', { name: 'Perform now: Whitening' })).toBeTruthy();

    // A tooth takes the selection back; Esc clears an area.
    fireEvent.click(card.getByRole('button', { name: /^#16 · / }));
    expect(panel().getByRole('heading', { name: '#16' })).toBeTruthy();
    fireEvent.click(card.getByRole('button', { name: /^Upper jaw/ }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(panel().getByText('No tooth selected')).toBeTruthy();
  });

  it('adds a service to the selected jaw in one click', async () => {
    const fetchMock = mockWorkspace({
      visit: () => visit(),
      chart: () => chart(),
      services: SERVICES,
    });
    renderWorkspace();
    const card = await chartCard();
    fireEvent.click(card.getByRole('button', { name: /^Lower jaw/ }));
    fireEvent.click(panel().getByRole('button', { name: 'Add completed service' }));
    const drawer = await screen.findByRole('dialog', { name: 'Add completed service' });
    fireEvent.click(await within(drawer).findByRole('button', { name: /^Whitening/ }));
    expect(within(drawer).queryByText('Composite filling')).toBeNull();
    await waitFor(() => {
      expect(sent(fetchMock, 'POST', `/visits/${VISIT_ID}/services`)).toEqual({
        procedureId: id(44),
        jaw: 'lower',
        surfaces: [],
      });
    });
  });

  it('is read-only for front desk', async () => {
    mockLevels();
    renderWorkspace({ permissions: FRONT_DESK });
    const card = await chartCard();
    expect(
      within(screen.getByRole('region', { name: "Today's services" })).queryByRole('button', {
        name: /^Actions: /,
      }),
    ).toBeNull();
    fireEvent.click(card.getByRole('button', { name: /^Whole mouth/ }));
    expect(panel().queryByRole('button', { name: /^Add/ })).toBeNull();
  });
});
