import {
  EMPTY_MEDICAL_HISTORY,
  type MedicalHistoryInput,
  type MedicalOption,
  toMedicalHistoryInput,
} from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { ToastProvider } from '@/components/ui/toast';
import { json, MEDICAL_OPTIONS, problem } from '../patients.test-utils';
import { HistoryFields } from './history-fields';

const EMPTY = toMedicalHistoryInput(EMPTY_MEDICAL_HISTORY);
const KIWI_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c7001';
const KIWI: MedicalOption = { id: KIWI_ID, kind: 'allergy', name: 'Kiwi', active: true };
const optionId = (name: string) => MEDICAL_OPTIONS.find((option) => option.name === name)?.id;

function mockOptions(added: Response = json(KIWI)) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(init?.method === 'POST' ? added : json(MEDICAL_OPTIONS)),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderFields(initial: MedicalHistoryInput = EMPTY) {
  const seen: MedicalHistoryInput[] = [];
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <HistoryFields
        value={value}
        onChange={(next) => {
          seen.push(next);
          setValue(next);
        }}
      />
    );
  }
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <Harness />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { last: () => seen.at(-1) };
}

const box = (name: string) => screen.getByRole<HTMLInputElement>('combobox', { name });
const pills = (name: string) =>
  within(screen.getByRole('group', { name }))
    .queryAllByRole('listitem')
    .map((pill) => pill.textContent.replace('×', ''));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HistoryFields', () => {
  it('suggests the clinic’s allergies as one types, and adds the pick as a pill', async () => {
    mockOptions();
    const { last } = renderFields();
    const input = box('Allergies');
    input.focus();
    fireEvent.change(input, { target: { value: 'pen' } });
    const option = await screen.findByRole('option', { name: 'Penicillin' });
    expect(screen.queryByRole('option', { name: 'Latex' })).toBeNull();
    fireEvent.click(option);

    expect(pills('Allergies')).toEqual(['Penicillin']);
    expect(last()?.allergyIds).toEqual([optionId('Penicillin')]);
    // Ready for the next one: the text is gone, and what was picked is no longer offered.
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual(['Latex']);
  });

  it('picks with the keyboard, and leaves Enter alone while nothing is typed', async () => {
    mockOptions();
    const { last } = renderFields();
    const input = box('Conditions');
    input.focus();
    await screen.findByRole('option', { name: 'Asthma' });
    // Nothing is marked in an empty box: Enter is the form's.
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
    expect(last()).toBeUndefined();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Diabetes' }).id,
    );
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
    expect(pills('Conditions')).toEqual(['Diabetes']);

    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(pills('Conditions')).toEqual([]);
    expect(last()?.conditionIds).toEqual([]);
  });

  it('adds a name the clinic does not have yet, and offers it from then on', async () => {
    const fetchMock = mockOptions();
    const { last } = renderFields();
    const input = box('Allergies');
    input.focus();
    fireEvent.change(input, { target: { value: ' Kiwi' } });
    await screen.findByRole('option', { name: 'Add “Kiwi”' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(pills('Allergies')).toEqual(['Kiwi']);
    });
    const [, init] = fetchMock.mock.calls.find(([, request]) => request?.method === 'POST') ?? [];
    expect(JSON.parse(init?.body as string)).toEqual({ kind: 'allergy', name: 'Kiwi' });
    expect(last()?.allergyIds).toEqual([KIWI_ID]);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Kiwi' }));
    fireEvent.change(input, { target: { value: 'ki' } });
    expect(await screen.findByRole('option', { name: 'Kiwi' })).toBeTruthy();
  });

  it('adds what is left in the box when it loses the focus, as typed', async () => {
    mockOptions();
    const { last } = renderFields();
    const input = box('Allergies');
    input.focus();
    // A prefix is not a pick: "lat" is not Latex.
    fireEvent.change(input, { target: { value: 'latex ' } });
    await screen.findByRole('option', { name: 'Latex' });
    fireEvent.blur(input);
    expect(pills('Allergies')).toEqual(['Latex']);
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { value: 'Kiwi' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(pills('Allergies')).toEqual(['Latex', 'Kiwi']);
    });
    expect(last()?.allergyIds).toEqual([optionId('Latex'), KIWI_ID]);
  });

  it('says so when a new name cannot be added', async () => {
    mockOptions(problem(403, 'forbidden'));
    renderFields();
    const input = box('Allergies');
    input.focus();
    fireEvent.change(input, { target: { value: 'Kiwi' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Add “Kiwi”' }));
    expect(await screen.findByText(/^Couldn’t add Kiwi/)).toBeTruthy();
    expect(pills('Allergies')).toEqual([]);
  });

  it('keeps "None known" as the explicit answer, taken back by a pill', async () => {
    mockOptions();
    const { last } = renderFields();
    const group = within(screen.getByRole('group', { name: 'Allergies' }));
    const none = group.getByRole('button', { name: 'None known' });
    fireEvent.click(none);
    expect(last()).toMatchObject({ noKnownAllergies: true, allergyIds: [] });
    expect(none.getAttribute('aria-pressed')).toBe('true');

    const input = box('Allergies');
    input.focus();
    fireEvent.click(await screen.findByRole('option', { name: 'Latex' }));
    expect(last()).toMatchObject({ noKnownAllergies: false, allergyIds: [optionId('Latex')] });
  });

  it('closes the suggestions on Escape without closing what is around it', async () => {
    mockOptions();
    renderFields();
    const input = box('Allergies');
    input.focus();
    fireEvent.change(input, { target: { value: 'la' } });
    await screen.findByRole('option', { name: 'Latex' });
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(false);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input.value).toBe('');
    // Nothing left to close: the next Escape is the panel's.
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(true);
  });
});
