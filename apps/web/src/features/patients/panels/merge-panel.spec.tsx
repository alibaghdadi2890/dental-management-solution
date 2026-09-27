import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, patient, problem, renderPanels, sent } from '../patients.test-utils';

const OLDER = patient(1, 'Rana Haddad', {
  phone: '+9613123456',
  email: 'rana@example.com',
  medicalAlerts: ['Penicillin allergy'],
});
const NEWER = patient(2, 'Rana Haddad', {
  phone: '+9613654321',
  email: null,
  medicalAlerts: ['Latex', 'penicillin allergy'],
});
const URL = `/?panel=merge:${NEWER.id},${OLDER.id}`;

const mergePanel = () => screen.findByRole('complementary', { name: 'Choose what to keep' });
const radio = (name: string) => screen.getByRole<HTMLInputElement>('radio', { name });

const openConfirm = async () => {
  fireEvent.click(within(await mergePanel()).getByRole('button', { name: 'Merge records' }));
  return screen.findByRole('alertdialog');
};

describe('MergePanel', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('compares only the differing fields, keeps the older ID and its values by default', async () => {
    mockApi({ patients: [OLDER, NEWER] });
    renderPanels({ url: URL });
    const aside = await mergePanel();
    expect(
      within(aside)
        .getAllByRole('radiogroup')
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['Keep ID', 'Phone', 'Email']);
    expect(radio('Keep this ID P-000001').checked).toBe(true);
    expect(radio('Phone from P-000001: 03 123 456').checked).toBe(true);
    expect(radio('Email from P-000001: rana@example.com').checked).toBe(true);
    expect(within(aside).getByText(/9 other fields match\./)).toBeTruthy();
    expect(
      within(aside).getByText(/P-000002 will be archived\. Its balance moves to P-000001\./),
    ).toBeTruthy();
  });

  it('shows the union of both records’ alerts, which is not pickable', async () => {
    mockApi({ patients: [OLDER, NEWER] });
    renderPanels({ url: URL });
    const aside = await mergePanel();
    const alerts = within(aside).getByRole('list', { name: 'Alerts' });
    expect(
      within(alerts)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Penicillin allergy', 'Latex']);
    expect(within(aside).getByText('Alerts from both records are kept.')).toBeTruthy();
  });

  it('sends the picked values, and needs a reason of at least 3 characters', async () => {
    const fetchMock = mockApi({ patients: [OLDER, NEWER] });
    const router = renderPanels({ url: URL });
    await mergePanel();
    fireEvent.click(radio('Phone from P-000002: 03 654 321'));
    expect(radio('Phone from P-000002: 03 654 321').checked).toBe(true);
    expect(radio('Phone from P-000001: 03 123 456').checked).toBe(false);

    const dialog = await openConfirm();
    expect(within(dialog).getByText('Merge P-000002 into P-000001?')).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Merge records' });
    const reason = within(dialog).getByRole('textbox');
    fireEvent.change(reason, { target: { value: 'ab' } });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(reason, { target: { value: 'Same person' } });
    expect(confirm).toHaveProperty('disabled', false);
    fireEvent.click(confirm);

    expect(await screen.findByText('Records merged')).toBeTruthy();
    expect(sent(fetchMock, 'POST', '/patients/merge')).toEqual({
      keepId: OLDER.id,
      dropId: NEWER.id,
      fieldChoices: { phone: 'drop', email: 'keep' },
      reason: 'Same person',
    });
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ panel: `quick:${OLDER.id}` });
    });
  });

  it('switching the kept ID resets the picks to the new survivor', async () => {
    const fetchMock = mockApi({ patients: [OLDER, NEWER] });
    renderPanels({ url: URL });
    await mergePanel();
    fireEvent.click(radio('Phone from P-000002: 03 654 321'));
    fireEvent.click(radio('Merge into other P-000002'));
    expect(radio('Keep this ID P-000002').checked).toBe(true);
    expect(radio('Phone from P-000002: 03 654 321').checked).toBe(true);
    expect(radio('Email from P-000002: —').checked).toBe(true);

    const dialog = await openConfirm();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Duplicate' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge records' }));
    await screen.findByText('Records merged');
    expect(sent(fetchMock, 'POST', '/patients/merge')).toMatchObject({
      keepId: NEWER.id,
      dropId: OLDER.id,
      fieldChoices: { phone: 'keep', email: 'keep' },
    });
  });

  it('blocks Merge when the alerts together would exceed 20', async () => {
    const many = (prefix: string) => Array.from({ length: 11 }, (_, i) => `${prefix} ${String(i)}`);
    mockApi({
      patients: [
        { ...OLDER, medicalAlerts: many('Allergy') },
        { ...NEWER, medicalAlerts: many('Condition') },
      ],
    });
    renderPanels({ url: URL });
    const aside = await mergePanel();
    expect(within(aside).getByRole('alert').textContent).toContain('more than 20 medical alerts');
    expect(within(aside).getByRole('button', { name: 'Merge records' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('keeps the dialog open with an inline error when a record was archived meanwhile', async () => {
    mockApi({
      patients: [OLDER, NEWER],
      mutation: (method, path) =>
        path === '/patients/merge' ? problem(409, 'patient.archived') : undefined,
    });
    renderPanels({ url: URL });
    await mergePanel();
    const dialog = await openConfirm();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Duplicate' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge records' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      "Couldn't merge: the record is archived",
    );
  });

  it('refuses to merge an archived record', async () => {
    mockApi({ patients: [OLDER, { ...NEWER, archivedAt: '2026-09-01T10:00:00.000Z' }] });
    renderPanels({ url: URL });
    const aside = await mergePanel();
    expect(within(aside).getByRole('alert').textContent).toContain("can't be merged");
    expect(within(aside).queryByRole('button', { name: 'Merge records' })).toBeNull();
  });
});
