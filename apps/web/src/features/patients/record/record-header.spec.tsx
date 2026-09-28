import { ageOn, type Patient } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { todayIn } from '@/lib/format';
import {
  json,
  mockApi,
  patient,
  patientContact,
  problem,
  renderRecord,
  sent,
} from '../patients.test-utils';

const RANA = patient(1, 'Rana Haddad', {
  dateOfBirth: '1990-05-01',
  medicalAlerts: ['Penicillin allergy', 'Latex'],
});
const KEPT = patient(2, 'Rana Haddad');
const recordOf = (p: Patient) => `/patients/${p.id}`;

const header = () => screen.findByRole('banner');

// Born on 1 January 10 (or 30) years before the tenant's today: 9–10 years old (a minor), or
// 29–30 (an adult), whatever day the tests run.
const year = Number(todayIn('Asia/Beirut').slice(0, 4));
const bornYearsAgo = (years: number) => `${String(year - years)}-01-01`;
const KARIM = patient(4, 'Karim Haddad', { dateOfBirth: bornYearsAgo(10), phone: null });
const guardianChip = (banner: HTMLElement) => within(banner).queryByText(/^Guardian ·/);

describe('RecordHeader', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the name, number, age line, phone and alert chips', async () => {
    mockApi({ patients: [RANA] });
    renderRecord({ url: recordOf(RANA) });
    const banner = await header();
    expect(within(banner).getByRole('heading', { level: 1, name: 'Rana Haddad' })).toBeTruthy();
    expect(within(banner).getByText('P-000001')).toBeTruthy();
    const age = ageOn('1990-05-01', todayIn('Asia/Beirut'));
    expect(within(banner).getByText(`${String(age)} yrs · 1 May 1990`)).toBeTruthy();
    expect(within(banner).getByText('03 123 456')).toBeTruthy();
    const alerts = within(banner).getByRole('list', { name: 'Medical alerts' });
    expect(
      within(alerts)
        .getAllByRole('listitem')
        .map((chip) => chip.textContent),
    ).toEqual(['Penicillin allergy', 'Latex']);
  });

  describe('guardian chip (design addendum "Record")', () => {
    it('follows the alert chips for a minor: the primary guardian, with their phone', async () => {
      const minor = { ...KARIM, medicalAlerts: ['Latex'] };
      mockApi({
        patients: [minor],
        contacts: {
          [KARIM.id]: [
            patientContact(61, 'Sami Haddad', { isPrimaryGuardian: false }),
            patientContact(60, 'Maria Haddad'),
          ],
        },
      });
      renderRecord({ url: recordOf(minor) });
      const banner = await header();
      const chip = await within(banner).findByText(/^Guardian · Maria Haddad/);
      expect(chip.textContent).toBe('Guardian · Maria Haddad · 03 987 654');
      expect(chip.querySelector('[dir="ltr"]')?.textContent).toBe('03 987 654');
      expect(chip.className).toContain('bg-primary-tint');
      expect(chip.className).toContain('border-primary-tint-border');
      expect(chip.className).toContain('text-[11.5px]');
      const alerts = within(banner).getByRole('list', { name: 'Medical alerts' });
      expect(alerts.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('leaves out the phone of a guardian recorded without one', async () => {
      const maria = patientContact(60, 'Maria Haddad');
      mockApi({
        patients: [KARIM],
        contacts: { [KARIM.id]: [{ ...maria, contact: { ...maria.contact, phone: null } }] },
      });
      renderRecord({ url: recordOf(KARIM) });
      const chip = await within(await header()).findByText(/^Guardian ·/);
      expect(chip.textContent).toBe('Guardian · Maria Haddad');
    });

    it('names the first guardian when none is marked primary', async () => {
      mockApi({
        patients: [KARIM],
        contacts: { [KARIM.id]: [patientContact(61, 'Sami Haddad', { isPrimaryGuardian: false })] },
      });
      renderRecord({ url: recordOf(KARIM) });
      expect(await within(await header()).findByText(/^Guardian · Sami Haddad/)).toBeTruthy();
    });

    it('is absent for a minor without a guardian', async () => {
      const fetchMock = mockApi({
        patients: [KARIM],
        contacts: {
          [KARIM.id]: [
            patientContact(60, 'Maria Haddad', {
              isGuardian: false,
              isPrimaryGuardian: false,
              isEmergencyContact: true,
              isPrimaryEmergency: true,
            }),
          ],
        },
      });
      renderRecord({ url: recordOf(KARIM) });
      const banner = await header();
      await waitFor(() => {
        expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/contacts'))).toBe(true);
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(guardianChip(banner)).toBeNull();
      // Nor an empty place for chips: no alerts either.
      expect(banner.querySelector('[data-record-chips]')).toBeNull();
    });

    it('is absent for an adult, even one with a guardian', async () => {
      const adult = { ...KARIM, dateOfBirth: bornYearsAgo(30), phone: '+9613123456' };
      const fetchMock = mockApi({
        patients: [adult],
        contacts: { [KARIM.id]: [patientContact(60, 'Maria Haddad')] },
      });
      renderRecord({ url: recordOf(adult) });
      const banner = await header();
      await waitFor(() => {
        expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/contacts'))).toBe(true);
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(guardianChip(banner)).toBeNull();
    });
  });

  it('reads "Age not recorded" without a date of birth', async () => {
    const noDob = patient(3, 'Sami Khoury', { dateOfBirth: null });
    mockApi({ patients: [noDob] });
    renderRecord({ url: recordOf(noDob) });
    expect(await within(await header()).findByText('Age not recorded')).toBeTruthy();
    expect(within(await header()).queryByRole('list', { name: 'Medical alerts' })).toBeNull();
  });

  it('opens the edit panel over the list, and closing it returns to the record', async () => {
    mockApi({ patients: [RANA] });
    const { router } = renderRecord({ url: recordOf(RANA) });
    fireEvent.click(within(await header()).getByRole('button', { name: 'Edit patient' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/patients');
    });
    expect(router.state.location.search).toMatchObject({ panel: `edit:${RANA.id}` });
    const panel = await screen.findByRole('complementary', { name: 'Rana Haddad' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(recordOf(RANA));
    });
  });

  it('returns to the record once the edit panel is saved', async () => {
    const fetchMock = mockApi({ patients: [RANA] });
    const { router } = renderRecord({ url: recordOf(RANA) });
    fireEvent.click(within(await header()).getByRole('button', { name: 'Edit patient' }));
    const panel = await screen.findByRole('complementary', { name: 'Rana Haddad' });
    fireEvent.change(within(panel).getByRole('textbox', { name: /Insurance/ }), {
      target: { value: 'Allianz' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(recordOf(RANA));
    });
    expect(await screen.findByText('Patient updated')).toBeTruthy();
    expect(sent(fetchMock, 'PATCH', `/patients/${RANA.id}`)).toEqual({ insurance: 'Allianz' });
  });

  it('has no Edit patient without patient:write', async () => {
    mockApi({ patients: [RANA] });
    renderRecord({ url: recordOf(RANA), permissions: ['patient:read'] });
    const banner = await header();
    await within(banner).findByText('P-000001');
    expect(within(banner).queryByRole('button', { name: 'Edit patient' })).toBeNull();
  });

  it('shows Archived and Restore instead of Edit for an archived record, and restores it', async () => {
    let current: Patient = { ...RANA, archivedAt: '2026-09-01T10:00:00.000Z' };
    const fetchMock = mockApi({
      get: (path) => (path === `/patients/${RANA.id}` ? json(current) : undefined),
      mutation: (method, path) => {
        if (method !== 'POST' || path !== '/patients/restore') return undefined;
        current = { ...current, archivedAt: null, updatedAt: '2026-09-28T10:00:00.000Z' };
        return json([current]);
      },
    });
    renderRecord({ url: recordOf(RANA) });
    const banner = await header();
    await within(banner).findByText('Archived');
    expect(within(banner).queryByRole('button', { name: 'Edit patient' })).toBeNull();

    fireEvent.click(within(banner).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Rana Haddad restored')).toBeTruthy();
    expect(sent(fetchMock, 'POST', '/patients/restore')).toEqual({ ids: [RANA.id] });
    const edit = await within(banner).findByRole('button', { name: 'Edit patient' });
    expect(within(banner).queryByText('Archived')).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(edit);
    });
  });

  it('says why a restore failed, in the person’s language', async () => {
    const archived: Patient = { ...RANA, archivedAt: '2026-09-01T10:00:00.000Z' };
    mockApi({
      patients: [archived],
      mutation: (method, path) =>
        method === 'POST' && path === '/patients/restore'
          ? problem(409, 'patient.merged')
          : undefined,
    });
    renderRecord({ url: recordOf(archived) });
    fireEvent.click(await within(await header()).findByRole('button', { name: 'Restore' }));
    expect(
      await screen.findByText("Couldn't restore: the record has already been merged into another"),
    ).toBeTruthy();
  });

  it('links a merged record to the kept one, without Restore', async () => {
    const merged: Patient = {
      ...RANA,
      archivedAt: '2026-09-01T10:00:00.000Z',
      mergedIntoId: KEPT.id,
    };
    mockApi({ patients: [merged, KEPT] });
    const { router } = renderRecord({ url: recordOf(merged) });
    const banner = await header();
    const link = await within(banner).findByRole('link', { name: 'Merged into P-000002' });
    expect(within(banner).queryByRole('button', { name: 'Restore' })).toBeNull();
    expect(within(banner).queryByRole('button', { name: 'Edit patient' })).toBeNull();
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(recordOf(KEPT));
    });
    expect(await within(await header()).findByText('P-000002')).toBeTruthy();
  });

  it('goes back to the previous screen from All patients', async () => {
    mockApi({ patients: [RANA] });
    const { router } = renderRecord({ url: recordOf(RANA), before: ['/visits'] });
    fireEvent.click(within(await header()).getByRole('button', { name: 'All patients' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/visits');
    });
  });

  it('goes to the list from All patients when the record was opened directly', async () => {
    mockApi({ patients: [RANA] });
    const { router } = renderRecord({ url: recordOf(RANA) });
    fireEvent.click(within(await header()).getByRole('button', { name: 'All patients' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/patients');
    });
    expect(await screen.findByRole('heading', { name: 'Patients' })).toBeTruthy();
  });
});
