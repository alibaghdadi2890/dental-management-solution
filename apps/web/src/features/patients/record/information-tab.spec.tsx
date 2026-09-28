import type { Patient } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi, patient, problem, renderRecord, sent } from '../patients.test-utils';
import { SAVED_SHOWN_MS } from './information-tab';

const RANA = patient(1, 'Rana Haddad', { email: 'rana@example.com' });
const URL_ = `/patients/${RANA.id}?tab=information`;

/** The loaded tab's card (the loading skeleton's card carries the same title). */
const card = async () => {
  await screen.findByText('Nothing here is required. Fill it in when it becomes relevant.');
  return screen.getByRole('region', { name: 'Patient information' });
};
const field = (name: RegExp | string) => screen.getByRole<HTMLInputElement>('textbox', { name });
const saveButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Save changes' });
const indicator = async () =>
  (await card()).querySelector('form [role="status"]')?.textContent ?? null;
const type = (name: RegExp | string, value: string) => {
  fireEvent.change(field(name), { target: { value } });
};

/** PATCH answers with the patient as sent, stamped as updated. */
const saved = (base: Patient, body: unknown): Patient => ({
  ...base,
  ...(body as Partial<Patient>),
  updatedAt: '2026-09-28T10:00:00.000Z',
});

/** A server holding one patient: `GET` reads what the last `PATCH` saved. `answer` may delay the
 * PATCH's response or turn it into an error. */
function serverWith(
  start: Patient,
  answer: (ok: () => Response) => Response | Promise<Response> = (ok) => ok(),
) {
  let current = start;
  return mockApi({
    get: (path) => (path === `/patients/${start.id}` ? json(current) : undefined),
    mutation: (method, path, body) => {
      if (method !== 'PATCH' || path !== `/patients/${start.id}`) return undefined;
      return answer(() => {
        current = saved(current, body);
        return json(current);
      });
    },
  });
}

describe('InformationTab', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('is the whole patient form, filled in, with nothing to save yet', async () => {
    mockApi({ patients: [RANA] });
    renderRecord({ url: URL_ });
    const form = await card();
    expect(within(form).getByText('Partly complete')).toBeTruthy();
    expect(
      within(form).getByText('Nothing here is required. Fill it in when it becomes relevant.'),
    ).toBeTruthy();
    expect(field(/Full name/).value).toBe('Rana Haddad');
    expect(field(/Phone/).value).toBe('03 123 456');
    expect(field(/Date of birth/).value).toBe('01/05/1990');
    expect(field('Email').value).toBe('rana@example.com');
    for (const name of ['Address', 'Insurance', 'Emergency contact', /Medical alerts/, 'Notes']) {
      expect(within(form).getByRole('textbox', { name })).toBeTruthy();
    }
    expect(within(form).getByRole('combobox', { name: 'Sex' })).toBeTruthy();
    expect(within(form).getByRole('combobox', { name: 'Primary dentist' })).toBeTruthy();
    expect(within(form).queryByRole('textbox', { name: /Guardian/ })).toBeNull();
    expect(saveButton().disabled).toBe(true);
    expect(await indicator()).toBe('');
  });

  it('shows the guardian fields for a minor', async () => {
    mockApi({ patients: [RANA] });
    renderRecord({ url: URL_ });
    await card();
    type(/Date of birth/, '01/05/2020');
    expect(field(/Guardian name/)).toBeTruthy();
    expect(field(/Guardian phone/)).toBeTruthy();
  });

  it('saves only what changed, moving from Unsaved to Saving to Saved, and the badge follows', async () => {
    let release: () => void = () => undefined;
    const fetchMock = serverWith(
      RANA,
      (ok) =>
        new Promise<Response>((resolve) => {
          release = () => {
            resolve(ok());
          };
        }),
    );
    renderRecord({ url: URL_ });
    const form = await card();
    type('Address', '12 Hamra St, Beirut');
    expect(await indicator()).toBe('Unsaved changes');
    expect(saveButton().disabled).toBe(false);

    fireEvent.click(saveButton());
    await waitFor(async () => {
      expect(await indicator()).toBe('Saving…');
    });
    expect(saveButton().disabled).toBe(true);
    expect(sent(fetchMock, 'PATCH', `/patients/${RANA.id}`)).toEqual({
      address: '12 Hamra St, Beirut',
    });

    release();
    await waitFor(async () => {
      expect(await indicator()).toBe('✓ Saved just now');
    });
    expect(within(form).getByText('Complete')).toBeTruthy();
    expect(within(form).queryByText('Partly complete')).toBeNull();
    expect(await screen.findByText('Patient information updated')).toBeTruthy();
    expect(field('Address').value).toBe('12 Hamra St, Beirut');
    expect(saveButton().disabled).toBe(true);

    type('Insurance', 'Allianz');
    expect(await indicator()).toBe('Unsaved changes');
  });

  it('lets "Saved just now" go quiet after a while', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serverWith(RANA);
    renderRecord({ url: URL_ });
    await card();
    type('Address', '12 Hamra St');
    fireEvent.click(saveButton());
    await waitFor(async () => {
      expect(await indicator()).toBe('✓ Saved just now');
    });
    await vi.advanceTimersByTimeAsync(SAVED_SHOWN_MS);
    await waitFor(async () => {
      expect(await indicator()).toBe('');
    });
  });

  it('keeps the input when a save fails, and retries from the indicator', async () => {
    let fail = true;
    const fetchMock = serverWith(RANA, (ok) => (fail ? problem(500, 'internal') : ok()));
    renderRecord({ url: URL_ });
    await card();
    type('Address', '12 Hamra St');
    fireEvent.click(saveButton());
    const retry = await screen.findByRole('button', { name: 'Failed to save — retry' });
    expect(field('Address').value).toBe('12 Hamra St');
    expect(await screen.findByText(/^Couldn't save:/)).toBeTruthy();

    fail = false;
    fireEvent.click(retry);
    await waitFor(async () => {
      expect(await indicator()).toBe('✓ Saved just now');
    });
    const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(patches).toHaveLength(2);
    expect(sent(fetchMock, 'PATCH', `/patients/${RANA.id}`)).toEqual({ address: '12 Hamra St' });
  });

  it('puts a rejected field back on the form rather than failing the save', async () => {
    mockApi({
      patients: [RANA],
      mutation: (method) =>
        method === 'PATCH'
          ? problem(422, 'validation', [{ path: 'insurance', code: 'too_big', message: 'x' }])
          : undefined,
    });
    renderRecord({ url: URL_ });
    await card();
    type('Insurance', 'Allianz');
    fireEvent.click(saveButton());
    expect(await screen.findByText('Check this value')).toBeTruthy();
    expect(await indicator()).toBe('Unsaved changes');
    expect(document.activeElement).toBe(field('Insurance'));
  });

  it('validates before saving, without sending anything', async () => {
    const fetchMock = mockApi({ patients: [RANA] });
    renderRecord({ url: URL_ });
    await card();
    type('Email', 'not-an-email');
    fireEvent.click(saveButton());
    expect(await screen.findByText('Check the email address')).toBeTruthy();
    expect(sent(fetchMock, 'PATCH', `/patients/${RANA.id}`)).toBeUndefined();
  });

  it('asks before switching tabs while there are unsaved changes', async () => {
    mockApi({ patients: [RANA] });
    const { router } = renderRecord({ url: URL_ });
    await card();
    type('Address', '12 Hamra St');
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(router.state.location.search).toEqual({ tab: 'information' });
    expect(field('Address').value).toBe('12 Hamra St');

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    const again = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    fireEvent.click(within(again).getByRole('button', { name: 'Discard and leave' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ tab: 'overview' });
    });
    expect(await screen.findByRole('region', { name: 'Treatment summary' })).toBeTruthy();
  });

  it('asks before leaving the record while there are unsaved changes', async () => {
    mockApi({ patients: [RANA] });
    const { router } = renderRecord({ url: URL_ });
    await card();
    type('Address', '12 Hamra St');
    fireEvent.click(screen.getByRole('button', { name: 'All patients' }));
    expect(
      await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/patients/${RANA.id}`);
  });

  it('is read-only for an archived record', async () => {
    const archived = { ...RANA, archivedAt: '2026-09-01T10:00:00.000Z' };
    mockApi({ patients: [archived] });
    renderRecord({ url: URL_ });
    const form = await card();
    expect(
      within(form).getByText(
        'This record is archived, so its details can’t be changed. Restore it to edit them.',
      ),
    ).toBeTruthy();
    expect(field('Address').matches(':disabled')).toBe(true);
    expect(within(form).queryByRole('button', { name: 'Save changes' })).toBeNull();
  });
});
