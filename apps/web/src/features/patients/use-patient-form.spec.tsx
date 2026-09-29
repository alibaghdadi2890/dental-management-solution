import type { Session } from '@dcm/contracts';
import { act, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { emptyForm, guardianLink } from './patient-form';
import { usePatientForm } from './use-patient-form';

type Tenant = NonNullable<Session['tenant']>;

const TENANT: Tenant = {
  id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d91',
  name: 'Northgate Dental',
  slug: 'northgate',
  timeZone: 'Asia/Beirut',
  currency: 'USD',
  locale: 'en',
  country: 'LB',
  chartMode: 'surface',
  toothNotation: 'fdi',
  chartOrientation: 'patient_right_on_right',
};

const CONTACT_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d70';
const DISPLAY = { fullName: 'Nadia', phone: '+9613123456', patientNumber: null, archived: false };

function renderForm(dateOfBirth = '') {
  return renderHook(() =>
    usePatientForm(
      () => ({ ...emptyForm({ fullName: 'Karim' }), dateOfBirth }),
      TENANT,
      createRef<HTMLFormElement>(),
      'create',
    ),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('usePatientForm — guardian block', () => {
  it("turns on and off at 18 by the tenant's today, not the browser's (UTC) date", () => {
    // 22:30 UTC on 27 Sep is already 01:30 on 28 Sep in Beirut (UTC+3).
    vi.useFakeTimers({ now: new Date('2026-09-27T22:30:00Z'), toFake: ['Date'] });
    // 18 on 28 Sep (Beirut's today), still 17 on 27 Sep (UTC's).
    expect(renderForm('2008-09-28').result.current.showGuardianBlock).toBe(false);
    expect(renderForm('2008-09-29').result.current.showGuardianBlock).toBe(true);
    expect(renderForm('').result.current.showGuardianBlock).toBe(false);
  });

  it('follows the date of birth as it is typed', () => {
    vi.useFakeTimers({ now: new Date('2026-09-28T09:00:00Z'), toFake: ['Date'] });
    const { result } = renderForm();
    act(() => {
      result.current.set('dateOfBirth')('2015-03-02');
    });
    expect(result.current.showGuardianBlock).toBe(true);
    expect(result.current.phoneOptional).toBe(true);
    act(() => {
      result.current.set('dateOfBirth')('1990-03-02');
    });
    expect(result.current.showGuardianBlock).toBe(false);
  });
});

describe('usePatientForm — pending contacts', () => {
  it('adds, updates and removes contacts and sets the link offer', () => {
    const { result } = renderForm('2015-03-02');
    act(() => {
      result.current.addContact(guardianLink({ contactId: CONTACT_ID }, 'parent'), DISPLAY);
    });
    const [pending] = result.current.values.pendingContacts;
    expect(pending?.link.isBillingContact).toBe(true);

    act(() => {
      result.current.updateContact(pending?.key ?? '', { isBillingContact: false });
    });
    expect(result.current.values.pendingContacts[0]?.link.isBillingContact).toBe(false);

    act(() => {
      result.current.removeContact(pending?.key ?? '');
    });
    expect(result.current.values.pendingContacts).toEqual([]);

    act(() => {
      result.current.setLinkContactId(CONTACT_ID);
    });
    expect(result.current.values.linkContactId).toBe(CONTACT_ID);
    act(() => {
      result.current.setLinkContactId(null);
    });
    expect(result.current.values.linkContactId).toBe('');
  });

  it("shows a contact's server error on its row, and drops it once the contacts change", () => {
    const { result } = renderForm('2015-03-02');
    act(() => {
      result.current.addContact(guardianLink({ contactId: CONTACT_ID }, 'parent'), DISPLAY);
      result.current.showServerErrors({
        'contacts.0': 'contactNotFound',
        linkContactId: 'contactNotFound',
        email: 'invalidEmail',
      });
    });
    expect(result.current.messageOf('contacts.0')).toBe('This contact no longer exists');
    expect(result.current.messageOf('linkContactId')).toBe('This contact no longer exists');

    act(() => {
      result.current.removeContact(result.current.values.pendingContacts[0]?.key ?? '');
    });
    expect(result.current.messageOf('contacts.0')).toBeUndefined();
    expect(result.current.messageOf('linkContactId')).toBeUndefined();
    expect(result.current.errors.email).toBe('invalidEmail');
  });
});
