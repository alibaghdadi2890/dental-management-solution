import {
  contactLookupItemSchema,
  contactViewSchema,
  patientContactSchema,
  toAsciiDigits,
  type ContactLinkInput,
  type ContactLinkPatch,
  type ContactPatch,
  type PatientContact,
} from '@dcm/contracts';
import { hashKey, type QueryClient, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { billingKeys } from '@/features/billing/billing-api';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';
import { patientKeys } from './patients-api';

/**
 * Contacts & family (design addendum C5): a patient's contacts, the search-or-create lookup, and
 * the link/patch/unlink/patch-contact actions, which apply immediately (never part of a dirty
 * form). The keys sit under `patientKeys.all` — a contact change shows on the list (the primary
 * guardian, C7) and on other patients linking the same contact, so `invalidatePatientData`
 * covers them, and switching the acting tenant never shows another clinic's contacts.
 */
export const contactKeys = {
  ofPatient: (tenantId: string | null, patientId: string) =>
    [...patientKeys.all(tenantId), 'contacts', patientId] as const,
  lookup: (tenantId: string | null, q: string) =>
    [...patientKeys.all(tenantId), 'contactLookup', q] as const,
};

const scope = (tenantId?: string) => (tenantId === undefined ? {} : { tenantId });

const patientContactsSchema = z.array(patientContactSchema);

/** `GET /patients/:id/contacts`: resolved, primaries first, then the oldest link. */
export function contactsQuery(patientId: string, tenantId?: string) {
  return queryOptions({
    queryKey: contactKeys.ofPatient(tenantId ?? actingTenantId(), patientId),
    queryFn: () =>
      apiFetch(`/patients/${patientId}/contacts`, patientContactsSchema, scope(tenantId)),
  });
}

/** What the lookup is asked for `text`: trimmed, Arabic-Indic digits as ASCII (the server's
 * phone match reads ASCII digits, as the palette's search does). */
function lookupText(text: string): string {
  return toAsciiDigits(text.trim());
}

/**
 * `GET /contacts/lookup?q=` (search-or-create): contacts and not-yet-contact patients by name or
 * by ≥ 2 phone digits, at most 10. Disabled while `q` is blank; debouncing is the caller's.
 */
export function contactLookupQuery(q: string, tenantId?: string) {
  const text = lookupText(q);
  return queryOptions({
    queryKey: contactKeys.lookup(tenantId ?? actingTenantId(), text),
    queryFn: () =>
      apiFetch(
        `/contacts/lookup?${new URLSearchParams({ q: text }).toString()}`,
        z.array(contactLookupItemSchema),
        scope(tenantId),
      ),
    enabled: text.length >= 1,
  });
}

/** `POST /patients/:id/contacts`; answers the patient's contacts after the link. */
export function linkContact(patientId: string, input: ContactLinkInput) {
  return apiFetch(`/patients/${patientId}/contacts`, patientContactsSchema, {
    method: 'POST',
    json: input,
  });
}

/** `PATCH /patients/:id/contacts/:contactId` (relationship, roles, primaries); answers the
 * patient's contacts, since moving a primary changes another link too. */
export function updateContactLink(patientId: string, contactId: string, patch: ContactLinkPatch) {
  return apiFetch(`/patients/${patientId}/contacts/${contactId}`, patientContactsSchema, {
    method: 'PATCH',
    json: patch,
  });
}

/** `DELETE /patients/:id/contacts/:contactId`; answers the remaining contacts. */
export function unlinkContact(patientId: string, contactId: string) {
  return apiFetch(`/patients/${patientId}/contacts/${contactId}`, patientContactsSchema, {
    method: 'DELETE',
  });
}

/** `PATCH /contacts/:id`: name, phone, e-mail of an *unlinked* contact (a linked one → 409
 * `contact.linked`: it is edited as its patient). */
export function updateContact(contactId: string, patch: ContactPatch) {
  return apiFetch(`/contacts/${contactId}`, contactViewSchema, { method: 'PATCH', json: patch });
}

/**
 * After a contact action on `patientId`: its contacts become the list the server answered, and
 * every other patients + billing query of the tenant is invalidated (the list's primary guardian,
 * other patients linking the same contact, the lookup, the export) — all but the list just set,
 * which would only be fetched again for nothing.
 */
export function settleContacts(
  queryClient: QueryClient,
  patientId: string,
  contacts: PatientContact[],
  tenantId: string | null = actingTenantId(),
): Promise<void> {
  const own = contactKeys.ofPatient(tenantId, patientId);
  queryClient.setQueryData(own, contacts);
  const ownHash = hashKey(own);
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: patientKeys.all(tenantId),
      predicate: (query) => query.queryHash !== ownHash,
    }),
    queryClient.invalidateQueries({ queryKey: billingKeys.all(tenantId) }),
  ]).then(() => undefined);
}
