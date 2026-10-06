import type { Visit } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { id, json } from '@/features/patients/patients.test-utils';
import {
  chart,
  FRONT_DESK,
  mockWorkspace,
  OLDER_VISIT_ID,
  renderWorkspace,
  sent,
  treatmentPlan,
  visit,
  VISIT_ID,
} from '../workspace/workspace.test-utils';

const earlier = { visitId: OLDER_VISIT_ID, date: '2026-08-21', note: null };
const unfinished = (n: number, name: string, tooth: '36' | '46') =>
  treatmentPlan(n, name, tooth, {
    status: 'in_progress',
    recordedInVisitId: OLDER_VISIT_ID,
    sessions: [earlier],
  });
const PLANS = [unfinished(20, 'Root canal', '36'), unfinished(22, 'Zircon crown', '46')];
const ANSWER = `/visits/${VISIT_ID}/unfinished-answer`;

/** A visit that has not answered yet; the answer route stamps it. */
function mockUnanswered(extra: Partial<Visit> = {}) {
  let current = visit(extra);
  return mockWorkspace({
    visit: () => current,
    chart: () => chart({ plans: PLANS }),
    mutation: (method, path) => {
      if (method !== 'POST' || path !== ANSWER) return undefined;
      current = { ...current, unfinishedAnsweredAt: '2026-09-04T09:01:00.000Z' };
      return json({ visit: current });
    },
  });
}

const dialog = () => screen.findByRole('dialog', { name: 'Unfinished services' });

describe('the unfinished services question', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('asks as the visit opens, each service ticked, and continues the ticked ones', async () => {
    const fetchMock = mockUnanswered();
    renderWorkspace();
    const question = within(await dialog());
    expect(question.getByText('Continue any of these today?')).toBeTruthy();
    const boxes = question.getAllByRole('checkbox');
    expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([true, true]);
    // It is answered, not dismissed.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Unfinished services' })).toBeTruthy();

    fireEvent.click(question.getByRole('checkbox', { name: /Zircon crown/ }));
    fireEvent.click(question.getByRole('button', { name: 'Continue' }));
    await waitFor(() => {
      expect(sent(fetchMock, 'POST', ANSWER)).toEqual({ continue: [id(20)] });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Unfinished services' })).toBeNull();
    });
  });

  it('"Not today" continues nothing; Continue needs a ticked service', async () => {
    const fetchMock = mockUnanswered();
    renderWorkspace();
    const question = within(await dialog());
    for (const box of question.getAllByRole('checkbox')) fireEvent.click(box);
    expect(question.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(question.getByRole('button', { name: 'Not today' }));
    await waitFor(() => {
      expect(sent(fetchMock, 'POST', ANSWER)).toEqual({ continue: [] });
    });
    // Still highlighted in the visit.
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Unfinished services' })).toBeNull();
    });
    expect(
      within(screen.getByRole('region', { name: "Today's services" })).getByText('To continue · 2'),
    ).toBeTruthy();
  });

  it('is not asked twice, nor of someone who cannot chart', async () => {
    mockUnanswered({ unfinishedAnsweredAt: '2026-09-04T09:01:00.000Z' });
    renderWorkspace();
    await screen.findByText('To continue · 2');
    expect(screen.queryByRole('dialog', { name: 'Unfinished services' })).toBeNull();
    cleanup();

    mockUnanswered();
    renderWorkspace({ permissions: FRONT_DESK });
    await screen.findByText('To continue · 2');
    expect(screen.queryByRole('dialog', { name: 'Unfinished services' })).toBeNull();
  });
});
