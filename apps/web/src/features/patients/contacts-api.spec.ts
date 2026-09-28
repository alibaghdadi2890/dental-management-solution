import type { PatientContact } from '@dcm/contracts';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn().mockResolvedValue([]);

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    apiFetch: (...args: unknown[]): Promise<unknown> => apiFetchMock(...args) as Promise<unknown>,
  };
});

const {
  contactKeys,
  contactLookupQuery,
  contactsQuery,
  linkContact,
  settleContacts,
  unlinkContact,
  updateContact,
  updateContactLink,
} = await import('./contacts-api');
const { patientKeys } = await import('./patients-api');
const { billingKeys } = await import('@/features/billing/billing-api');

const P1 = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d01';
const C1 = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d02';

async function runQueryFn(options: { queryFn?: unknown }): Promise<unknown> {
  return (options.queryFn as () => Promise<unknown>)();
}

afterEach(() => {
  apiFetchMock.mockClear();
});

describe('contactKeys', () => {
  it('sits under the patients umbrella of the tenant, so invalidatePatientData covers it', () => {
    expect(contactKeys.ofPatient('t1', P1)).toEqual(['patients', 't1', 'contacts', P1]);
    expect(contactKeys.lookup('t1', 'ma')).toEqual(['patients', 't1', 'contactLookup', 'ma']);
    expect(contactKeys.ofPatient('t1', P1).slice(0, 2)).toEqual(patientKeys.all('t1'));
    expect(contactKeys.ofPatient('t1', P1)).not.toEqual(contactKeys.ofPatient('t2', P1));
  });
});

describe('contactsQuery', () => {
  it('reads GET /patients/:id/contacts', async () => {
    await runQueryFn(contactsQuery(P1));
    expect(apiFetchMock).toHaveBeenCalledWith(`/patients/${P1}/contacts`, expect.anything(), {});
  });

  it('forwards an explicit tenant', async () => {
    const options = contactsQuery(P1, 't9');
    expect(options.queryKey).toEqual(contactKeys.ofPatient('t9', P1));
    await runQueryFn(options);
    expect(apiFetchMock).toHaveBeenCalledWith(`/patients/${P1}/contacts`, expect.anything(), {
      tenantId: 't9',
    });
  });
});

describe('contactLookupQuery', () => {
  it('is disabled for a blank query', () => {
    expect(contactLookupQuery('').enabled).toBe(false);
    expect(contactLookupQuery('   ').enabled).toBe(false);
    expect(contactLookupQuery('m').enabled).toBe(true);
  });

  it('sends the trimmed query, with Arabic-Indic digits as ASCII, encoded', async () => {
    const options = contactLookupQuery('  ٠٣ 12 ');
    expect(options.queryKey.at(-1)).toBe('03 12');
    await runQueryFn(options);
    expect(apiFetchMock).toHaveBeenCalledWith('/contacts/lookup?q=03+12', expect.anything(), {});
    await runQueryFn(contactLookupQuery('Rana & co'));
    expect(apiFetchMock).toHaveBeenLastCalledWith(
      '/contacts/lookup?q=Rana+%26+co',
      expect.anything(),
      {},
    );
  });
});

describe('mutations', () => {
  it('links with POST /patients/:id/contacts and the ContactLinkInput as body', async () => {
    const input = {
      target: { newContact: { fullName: 'Maria Haddad', phone: '+9613123456', email: null } },
      relationship: 'parent' as const,
      isGuardian: true,
      isBillingContact: true,
      isEmergencyContact: false,
    };
    await linkContact(P1, input);
    expect(apiFetchMock).toHaveBeenCalledWith(`/patients/${P1}/contacts`, expect.anything(), {
      method: 'POST',
      json: input,
    });
  });

  it('patches a link, unlinks, and patches a contact on their routes', async () => {
    await updateContactLink(P1, C1, { isPrimaryBilling: true });
    expect(apiFetchMock).toHaveBeenLastCalledWith(
      `/patients/${P1}/contacts/${C1}`,
      expect.anything(),
      { method: 'PATCH', json: { isPrimaryBilling: true } },
    );
    await unlinkContact(P1, C1);
    expect(apiFetchMock).toHaveBeenLastCalledWith(
      `/patients/${P1}/contacts/${C1}`,
      expect.anything(),
      { method: 'DELETE' },
    );
    await updateContact(C1, { phone: '03 123 456' });
    expect(apiFetchMock).toHaveBeenLastCalledWith(`/contacts/${C1}`, expect.anything(), {
      method: 'PATCH',
      json: { phone: '03 123 456' },
    });
  });

  it('parses the answers with the contract schemas', async () => {
    const { contactViewSchema } = await import('@dcm/contracts');
    const schemaOfLastCall = () =>
      (apiFetchMock.mock.lastCall as [string, { parse: (value: unknown) => unknown }])[1];
    const contact = {
      id: C1,
      fullName: 'Maria Haddad',
      phone: '+9613123456',
      email: null,
      linkedPatient: null,
    };
    const link = {
      contact,
      relationship: 'parent',
      isGuardian: true,
      isBillingContact: false,
      isEmergencyContact: false,
      isPrimaryGuardian: true,
      isPrimaryBilling: false,
      isPrimaryEmergency: false,
    };

    await unlinkContact(P1, C1);
    expect(schemaOfLastCall().parse([link])).toEqual([link]);
    expect(() => schemaOfLastCall().parse([{ contact }])).toThrow();
    await updateContact(C1, { fullName: 'Maria' });
    expect(schemaOfLastCall()).toBe(contactViewSchema);
  });
});

describe('settleContacts', () => {
  it("stores the answered list and invalidates the tenant's other patient and billing data", async () => {
    const client = new QueryClient();
    const own = contactKeys.ofPatient('t1', P1);
    const list = patientKeys.counts('t1');
    const balance = billingKeys.balance('t1', P1);
    const other = patientKeys.counts('t2');
    for (const key of [own, list, balance, other]) client.setQueryData(key, 'old');

    const contacts: PatientContact[] = [];
    await settleContacts(client, P1, contacts, 't1');

    expect(client.getQueryData(own)).toBe(contacts);
    expect(client.getQueryState(own)?.isInvalidated).toBe(false);
    expect(client.getQueryState(list)?.isInvalidated).toBe(true);
    expect(client.getQueryState(balance)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  });
});
