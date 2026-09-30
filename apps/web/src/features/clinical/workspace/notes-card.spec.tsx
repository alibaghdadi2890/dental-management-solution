import type { Visit } from '@dcm/contracts';
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
} from './workspace.test-utils';

const NOTES_PATH = `/visits/${VISIT_ID}/notes`;

/** A fake server whose notes PATCH answers 500 while `failing` is set. */
function fakeNotes(initial: Visit = visit()) {
  const state = { visit: initial, failing: false };
  const fetchMock = mockWorkspace({
    visit: () => state.visit,
    mutation: (method, path, body) => {
      if (method !== 'PATCH' || path !== NOTES_PATH) return undefined;
      if (state.failing) return problem(500, 'internal');
      state.visit = { ...state.visit, notes: (body as { notes: string }).notes };
      return json({ visit: state.visit });
    },
  });
  return { state, fetchMock };
}

const notesCard = async () => {
  await screen.findByRole('group', { name: 'Upper arch' });
  return screen.getByRole('region', { name: 'Clinical notes' });
};

const notesField = () => screen.getByRole('textbox', { name: 'Clinical notes' });

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
  });
}

describe('NotesCard', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('autosaves as you type, debounced into one save', async () => {
    const { fetchMock } = fakeNotes();
    renderWorkspace();
    const card = await notesCard();
    expect(within(card).getByText('Belongs to this visit')).toBeTruthy();
    expect(within(card).getByText('Autosaves as you type')).toBeTruthy();
    expect(notesField().getAttribute('placeholder')).toBe(
      'What did you observe and do? e.g. Occlusal caries on #16, isolated with rubber dam, restored with bio composite. Patient tolerated well.',
    );

    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(notesField(), { target: { value: 'Occlusal' } });
    fireEvent.change(notesField(), { target: { value: 'Occlusal caries on #16.' } });
    expect(within(card).getByText('Saving…')).toBeTruthy();
    await settle();

    expect(await within(card).findByText('Saved just now')).toBeTruthy();
    const saves = fetchMock.mock.calls.filter(([url]) => url === `/api/v1${NOTES_PATH}`);
    expect(saves).toHaveLength(1);
    expect(sent(fetchMock, 'PATCH', NOTES_PATH)).toEqual({ notes: 'Occlusal caries on #16.' });
  });

  it('keeps the text when the save fails, and retry re-sends it', async () => {
    const { state, fetchMock } = fakeNotes();
    state.failing = true;
    renderWorkspace();
    const card = await notesCard();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(notesField(), { target: { value: 'Rubber dam placed.' } });
    await settle();
    const retry = await within(card).findByRole('button', { name: 'Failed to save — retry' });
    expect((notesField() as HTMLTextAreaElement).value).toBe('Rubber dam placed.');

    state.failing = false;
    fireEvent.click(retry);
    expect(await within(card).findByText('Saved just now')).toBeTruthy();
    expect(sent(fetchMock, 'PATCH', NOTES_PATH)).toEqual({ notes: 'Rubber dam placed.' });
    expect((notesField() as HTMLTextAreaElement).value).toBe('Rubber dam placed.');
  });

  it('hides Discard visit while the notes have unsaved edits', async () => {
    const { state } = fakeNotes();
    state.failing = true;
    renderWorkspace();
    await notesCard();
    expect(await screen.findByRole('button', { name: 'Visit actions' })).toBeTruthy();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(notesField(), { target: { value: 'Draft' } });
    expect(screen.queryByRole('button', { name: 'Visit actions' })).toBeNull();
    await settle();
    await screen.findByRole('button', { name: 'Failed to save — retry' });
    expect(screen.queryByRole('button', { name: 'Visit actions' })).toBeNull();
  });

  it('shows the notes as text for front desk', async () => {
    fakeNotes(visit({ notes: 'Checked the fissures.' }));
    renderWorkspace({ permissions: FRONT_DESK });
    const card = await notesCard();
    expect(within(card).getByText('Checked the fissures.')).toBeTruthy();
    expect(within(card).queryByRole('textbox')).toBeNull();
    expect(within(card).queryByText('Autosaves as you type')).toBeNull();
  });
});
