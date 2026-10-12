import type { PatientChart, Permission, Visit } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { DENTIST_ID, json } from '@/features/patients/patients.test-utils';
import {
  chart,
  DENTIST_WRITE,
  diagnosisRecord,
  mockWorkspace,
  OLDER_VISIT_ID,
  RANA,
  renderWorkspace,
  sent,
  serviceItem,
  treatmentPlan,
  visit,
  VISIT_ID,
  visitService,
} from '../workspace/workspace.test-utils';

const DENTIST: Permission[] = [...DENTIST_WRITE, 'patient:write', 'chart:write'];
const OLD = { recordedInVisitId: OLDER_VISIT_ID };
const path = (rest: string) => `/visits/${VISIT_ID}/${rest}`;

const steps = (type: string) => screen.findByRole('navigation', { name: `${type} visit steps` });
const stepButton = (nav: HTMLElement, name: RegExp) => within(nav).getByRole('button', { name });
const names = (nav: HTMLElement) =>
  within(nav)
    .getAllByRole('button')
    .map((button) => button.textContent);

/** A fake server for one visit: every flow write answers the visit as it then is. */
function server(initial: Visit, charted: PatientChart = chart()) {
  const state = { visit: initial, chart: charted };
  const fetchMock = mockWorkspace({
    visit: () => state.visit,
    chart: () => state.chart,
    services: [
      serviceItem(40, 'Composite filling', { frequent: true }),
      serviceItem(42, 'Whitening', { chargeUnit: 'per_mouth' }),
      serviceItem(44, 'Night guard', { chargeUnit: 'per_jaw' }),
    ],
    reads: {
      [`/clinical/patients/${RANA.id}/history-confirmation`]: { confirmation: null },
      [`/clinical/patients/${RANA.id}/last-visit`]: null,
      '/medical-history/options': [],
      '/files': { items: [] },
    },
    mutation: (method, url, body) => {
      const answer = (patch: Partial<Visit>) => {
        state.visit = { ...state.visit, ...patch };
        return json({ visit: state.visit });
      };
      if (url === path('step')) return answer(body as Pick<Visit, 'currentStep'>);
      if (url === path('view')) return answer(body as Pick<Visit, 'viewMode'>);
      if (url === path('history-confirmation')) {
        return answer({
          historyConfirmation:
            method === 'PUT'
              ? { at: '2026-09-04T09:04:00.000Z', by: DENTIST_ID, byName: 'Dr. Ana Reyes' }
              : null,
        });
      }
      const ticked = /^\/visits\/[^/]+\/worklist\/([^/]+)$/.exec(url)?.[1];
      if (ticked) {
        const others = state.visit.worklist.filter((item) => item.planId !== ticked);
        return answer({
          worklist: method === 'PUT' ? [...others, { planId: ticked }] : others,
        });
      }
      return undefined;
    },
  });
  return { state, fetchMock };
}

describe('visit flows', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('opens a treatment visit on Today’s work and takes the item on to Perform', async () => {
    const rootCanal = treatmentPlan(32, 'Root canal treatment', '26', {
      ...OLD,
      status: 'in_progress',
      estimatedSessions: 3,
      sessions: [{ visitId: OLDER_VISIT_ID, date: '2026-08-01', note: null }],
    });
    const { fetchMock } = server(
      visit({ viewMode: 'steps', worklist: [{ planId: rootCanal.id }] }),
      chart({
        plans: [rootCanal, treatmentPlan(30, 'Crown', '16', { ...OLD, priority: 'urgent' })],
      }),
    );
    renderWorkspace({ permissions: DENTIST });

    const nav = await steps('Treatment');
    expect(names(nav)).toEqual(['1Today’s work', '2Perform', '3Complete']);
    expect(stepButton(nav, /^Today’s work/).getAttribute('aria-current')).toBe('step');
    // Only what this step is for: no chart, no price list.
    expect(screen.queryByRole('region', { name: 'Dental chart' })).toBeNull();
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();

    // The whole plan by priority; only the root canal is on today's list.
    expect(await screen.findByText('1 treatment for today')).toBeTruthy();
    const urgent = screen.getByRole('region', { name: 'Urgent' });
    expect(urgent.textContent).toContain('0 of 1 for today');
    expect(
      within(urgent).getByRole<HTMLInputElement>('checkbox', { name: 'For today: #16 Crown' })
        .checked,
    ).toBe(false);
    // Not on the list: nothing to perform from here.
    expect(within(urgent).queryByRole('button')).toBeNull();
    const card = within(screen.getByRole('region', { name: 'High' })).getByRole('listitem');
    expect(
      within(card).getByRole<HTMLInputElement>('checkbox', {
        name: 'For today: #26 Root canal treatment',
      }).checked,
    ).toBe(true);
    expect(card.textContent).toContain('Session 2 of 3');

    fireEvent.click(within(card).getByRole('button', { name: 'Continue Root canal treatment' }));
    await waitFor(() => {
      expect(stepButton(nav, /^Perform/).getAttribute('aria-current')).toBe('step');
    });
    expect(sent(fetchMock, 'PATCH', path('step'))).toEqual({ step: 'perform' });
    const planned = screen.getByRole('region', { name: 'Planned for today' });
    const row = within(planned).getByRole('listitem');
    // The item's tooth is selected: its row is highlighted and the tooth panel is on it.
    expect(row.getAttribute('aria-current')).toBe('true');
    const aside = screen.getByRole('complementary', { name: 'Selected tooth' });
    expect(await within(aside).findByRole('heading', { name: '#26' })).toBeTruthy();

    // Not finished logs this visit's session.
    fireEvent.click(
      within(row).getByRole('button', { name: 'Not finished: Root canal treatment' }),
    );
    await waitFor(() => {
      expect(sent(fetchMock, 'PUT', path(`plans/${rootCanal.id}/session`))).toEqual({
        note: null,
      });
    });
    expect(screen.getByRole('button', { name: 'Continue to Complete' })).toBeTruthy();
  });

  it('ticks a planned treatment onto today’s list, and off it', async () => {
    const crown = treatmentPlan(30, 'Crown', '16', { ...OLD, priority: 'urgent' });
    const { state, fetchMock } = server(visit({ viewMode: 'steps' }), chart({ plans: [crown] }));
    renderWorkspace({ permissions: DENTIST });
    const box = await screen.findByRole<HTMLInputElement>('checkbox', {
      name: 'For today: #16 Crown',
    });
    expect(screen.getByText('0 treatments for today')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Perform Crown' })).toBeNull();

    fireEvent.click(box);
    expect(await screen.findByRole('button', { name: 'Perform Crown' })).toBeTruthy();
    expect(sent(fetchMock, 'PUT', path(`worklist/${crown.id}`))).toBeNull();
    expect(state.visit.worklist).toEqual([{ planId: crown.id }]);
    expect(box.checked).toBe(true);
    expect(screen.getByText('1 treatment for today')).toBeTruthy();
    // The summary's total, and the row's price.
    expect(screen.getAllByText('$400')).toHaveLength(2);

    fireEvent.click(box);
    await waitFor(() => {
      expect(box.checked).toBe(false);
    });
    expect(state.visit.worklist).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Perform Crown' })).toBeNull();
  });

  it('shows the plan read-only to someone who cannot write the visit', async () => {
    const crown = treatmentPlan(30, 'Crown', '16', { ...OLD, priority: 'urgent' });
    server(
      visit({ viewMode: 'steps', worklist: [{ planId: crown.id }] }),
      chart({ plans: [crown] }),
    );
    renderWorkspace({ permissions: ['patient:read', 'visit:read', 'catalog:read'] });
    const box = await screen.findByRole<HTMLInputElement>('checkbox', {
      name: 'For today: #16 Crown',
    });
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Perform Crown' })).toBeNull();
  });

  it('moves between the steps with the arrow keys, and between Steps and All', async () => {
    const { fetchMock } = server(
      visit({ type: 'examination', currentStep: 'findings', viewMode: 'steps' }),
    );
    renderWorkspace({ permissions: DENTIST });
    const nav = await steps('Examination');
    // A paused or reopened visit lands on its stored step. Perform is there from the start.
    expect(names(nav)).toEqual([
      '1Intake',
      '2Examine',
      '3Findings',
      '4Plan',
      '5Performoptional',
      '6Complete',
    ]);
    const findings = stepButton(nav, /^Findings/);
    expect(findings.getAttribute('aria-current')).toBe('step');

    findings.focus();
    fireEvent.keyDown(findings, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(stepButton(nav, /^Plan/));
    fireEvent.keyDown(stepButton(nav, /^Plan/), { key: 'Home' });
    expect(document.activeElement).toBe(stepButton(nav, /^Intake/));
    // Enter on a button is its click.
    fireEvent.click(stepButton(nav, /^Intake/));
    expect(stepButton(nav, /^Intake/).getAttribute('aria-current')).toBe('step');
    expect(await screen.findByRole('region', { name: 'Medical history' })).toBeTruthy();

    // All: today's whole workspace, the stepper still there.
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    expect(await screen.findByRole('button', { name: 'Review & complete' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Treatment plan' })).toBeTruthy();
    expect(within(nav).queryByRole('button', { current: 'step' })).toBeNull();
    await waitFor(() => {
      expect(sent(fetchMock, 'PATCH', path('view'))).toEqual({ viewMode: 'all' });
    });

    // A step clicked from All opens it, back in the steps.
    fireEvent.click(stepButton(nav, /^Complete/));
    expect(await screen.findByRole('button', { name: 'Complete visit' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Steps' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Review & complete' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Complete visit' }));
    expect(await screen.findByRole('dialog', { name: 'Complete visit' })).toBeTruthy();
  });

  it('confirms the medical history at Intake', async () => {
    server(visit({ type: 'examination', currentStep: 'intake', viewMode: 'steps' }));
    renderWorkspace({ permissions: DENTIST });
    const card = await screen.findByRole('region', { name: 'Medical history' });
    expect(await within(card).findByText('Registered by front desk · not confirmed')).toBeTruthy();
    const confirm = within(card).getByRole<HTMLInputElement>('checkbox', {
      name: /Confirmed with the patient/,
    });
    expect(confirm.checked).toBe(false);

    fireEvent.click(confirm);
    expect(await within(card).findByText(/^Confirmed by Dr\. Ana Reyes · \d\d:\d\d$/)).toBeTruthy();
    expect(card.dataset.confirmed).toBe('true');
    expect(within(card).queryByText('Registered by front desk · not confirmed')).toBeNull();
    const nav = await steps('Examination');
    expect(stepButton(nav, /^Intake/).dataset.done).toBe('true');
  });

  it('leaves confirming to who may chart', async () => {
    server(visit({ type: 'examination', currentStep: 'intake', viewMode: 'steps' }));
    renderWorkspace({ permissions: DENTIST_WRITE });
    const card = await screen.findByRole('region', { name: 'Medical history' });
    expect(
      within(card).getByRole<HTMLInputElement>('checkbox', { name: /Confirmed with the patient/ })
        .disabled,
    ).toBe(true);
  });

  it('rates an emergency’s pain only once the slider is moved', async () => {
    server(visit({ type: 'emergency', currentStep: 'complaint', viewMode: 'steps' }));
    renderWorkspace({ permissions: DENTIST });
    const nav = await steps('Emergency');
    expect(names(nav)).toEqual(['1Complaint', '2Examine', '3Treat now', '4Complete']);
    expect(await screen.findByText('Not rated')).toBeTruthy();
    fireEvent.change(screen.getByRole('slider', { name: 'Pain' }), { target: { value: '8' } });
    expect(await screen.findByText('8 / 10')).toBeTruthy();
    const since = screen.getByRole('button', { name: '1–3 days' });
    fireEvent.click(since);
    expect(since.getAttribute('aria-pressed')).toBe('true');
  });

  it('carries an older diagnosis from Findings into the Plan step', async () => {
    const caries = diagnosisRecord(10, 'Deep caries', '24');
    const attrition = diagnosisRecord(12, 'Attrition', '26', {
      ...OLD,
      recordedDate: '2026-03-12',
    });
    const { fetchMock } = server(
      visit({ type: 'examination', currentStep: 'findings', viewMode: 'steps' }),
      chart({ diagnoses: [caries, attrition] }),
    );
    renderWorkspace({ permissions: DENTIST });
    const table = await screen.findByRole('table', { name: 'Diagnoses' });
    const rows = [...table.querySelectorAll<HTMLElement>('[data-record]')];
    expect(rows.map((row) => row.dataset.record)).toEqual([caries.id, attrition.id]);
    expect(rows[1]?.textContent).toContain('Recorded 12 Mar 2026');

    fireEvent.click(within(rows[1]!).getByRole('button', { name: /^Plan treatment/ }));
    // Both diagnoses have a card; the one that was asked for has the focus.
    const carried = await screen.findByRole('region', { name: '#26 · Attrition' });
    expect(screen.getByRole('region', { name: '#24 · Deep caries' })).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(carried);
    });

    fireEvent.click(within(carried).getByRole('radio', { name: 'Urgent' }));
    fireEvent.click(
      await within(carried).findByRole('button', { name: 'Propose Composite filling' }),
    );
    await waitFor(() => {
      expect(sent(fetchMock, 'POST', path('plans'))).toEqual({
        procedureId: serviceItem(40, 'Composite filling').id,
        toothCode: '26',
        surfaces: [],
        note: null,
        priority: 'urgent',
        diagnosisRecordId: attrition.id,
      });
    });
    // The three phases list every open item.
    expect(screen.getByRole('region', { name: 'High' }).textContent).toContain(
      'Nothing in this phase',
    );
  });

  it('plans other treatment on any tooth, a jaw or the whole mouth from the Plan step', async () => {
    const whitening = treatmentPlan(36, 'Whitening', null, { priority: 'elective' });
    const { fetchMock } = server(
      visit({ type: 'examination', currentStep: 'plan', viewMode: 'steps' }),
      chart({ plans: [whitening] }),
    );
    renderWorkspace({ permissions: DENTIST });
    // What this visit already planned off the cards is listed, with where it goes.
    const card = await screen.findByRole('region', { name: 'Other treatment' });
    expect(within(card).getByRole('listitem').textContent).toContain('Whole mouth');
    expect(within(card).getByRole('button', { name: 'Remove Whitening' })).toBeTruthy();
    // Nothing to pick from until the target is chosen.
    expect(within(card).queryByRole('searchbox')).toBeNull();

    const where = within(card).getByRole('combobox', { name: 'Where' });
    fireEvent.change(where, { target: { value: '36' } });
    // Only the services charged per tooth fit a tooth.
    const search = await within(card).findByRole('searchbox');
    fireEvent.change(search, { target: { value: 'guard' } });
    expect(within(card).getByText('Nothing matches.')).toBeTruthy();
    fireEvent.click(within(card).getByRole('radio', { name: 'Elective' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Propose Composite filling' }));
    await waitFor(() => {
      expect(sent(fetchMock, 'POST', path('plans'))).toEqual({
        procedureId: serviceItem(40, 'Composite filling').id,
        toothCode: '36',
        surfaces: [],
        note: null,
        priority: 'elective',
      });
    });

    fetchMock.mockClear();
    fireEvent.change(where, { target: { value: 'lower' } });
    fireEvent.change(await within(card).findByRole('searchbox'), { target: { value: 'guard' } });
    fireEvent.click(await within(card).findByRole('button', { name: /Night guard/ }));
    await waitFor(() => {
      expect(sent(fetchMock, 'POST', path('plans'))).toEqual({
        procedureId: serviceItem(44, 'Night guard').id,
        surfaces: [],
        jaw: 'lower',
        note: null,
        priority: 'elective',
      });
    });
  });

  it('keeps Other treatment to one quiet button until it is asked for', async () => {
    server(visit({ type: 'examination', currentStep: 'plan', viewMode: 'steps' }));
    renderWorkspace({ permissions: DENTIST });
    const open = await screen.findByRole('button', { name: '+ Add other treatment' });
    expect(screen.queryByRole('region', { name: 'Other treatment' })).toBeNull();
    fireEvent.click(open);
    expect(screen.getByRole('region', { name: 'Other treatment' })).toBeTruthy();
  });

  it('sums the visit up on Complete, a part with nothing left out', async () => {
    const rootCanal = treatmentPlan(32, 'Root canal treatment', '26', {
      ...OLD,
      status: 'in_progress',
      sessions: [
        { visitId: OLDER_VISIT_ID, date: '2026-08-01', note: null },
        { visitId: VISIT_ID, date: '2026-09-04', note: null },
      ],
    });
    server(
      visit({
        type: 'examination',
        currentStep: 'complete',
        viewMode: 'steps',
        services: [visitService(50, 'Examination', null, { autoAdded: true })],
        money: { subtotal: '80.00', discount: '0.00', total: '80.00', capped: false },
      }),
      chart({
        diagnoses: [diagnosisRecord(10, 'Deep caries', '24')],
        plans: [rootCanal, treatmentPlan(36, 'Composite', '24')],
      }),
    );
    renderWorkspace({ permissions: DENTIST });
    const block = await screen.findByRole('region', { name: 'This visit' });
    const parts = [...block.querySelectorAll<HTMLElement>('[data-part]')].map((part) => [
      part.dataset.part,
      within(part).getByRole('definition').firstElementChild?.textContent,
    ]);
    expect(parts).toEqual([
      ['recorded', '1 diagnosis'],
      ['planned', '1 item, $400'],
      ['done', '1 service · $80'],
      ['continues', '#26 Root canal treatment'],
    ]);
    expect(
      screen.getByText('Root canal treatment · #26 (continue)').closest('p')?.textContent,
    ).toBe('Next visit: Root canal treatment · #26 (continue)');
    // Perform holds work: ticked like any step with a record, and no longer "optional".
    const perform = stepButton(await steps('Examination'), /^Perform/);
    expect(perform.dataset.done).toBe('true');
    expect(perform.textContent).not.toContain('optional');
  });
});
