import type { ContactLinkInput, ContactLinkPatch, PatientContact } from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/ui/confirm-context';
import { useToast } from '@/components/ui/toast-context';
import type { ContactRowModel } from './contact-rows';
import { linkContact, settleContacts, unlinkContact, updateContactLink } from './contacts-api';
import { failureText } from './panels/form-server-errors';

/**
 * A saved patient's contact actions (design addendum C5), as the edit panel and the record's
 * Contacts & family card both run them: each applies at once through the contact routes, settles
 * the contacts (`settleContacts`: the list the server answered, then everything else that shows
 * them) and toasts — or toasts why it failed, in the person's language. `busy` while one runs, so
 * the others can wait. Removing asks first; its failure stays in the dialog.
 */
export function useContactActions(patientId: string) {
  const { t } = useTranslation('patients');
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const failed = (error: unknown) =>
    t('contacts.current.actionFailed', { reason: failureText(t, error) });

  /** Runs one contact action; true once it applied. */
  const run = async (action: () => Promise<PatientContact[]>, done: string) => {
    setBusy(true);
    try {
      void settleContacts(queryClient, patientId, await action());
      toast(done);
      return true;
    } catch (error) {
      toast(failed(error), { tone: 'danger' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    /** Links a contact (`POST`). */
    add: (link: ContactLinkInput) =>
      run(() => linkContact(patientId, link), t('contacts.current.added')),
    /** Changes a link's relationship, roles or primaries (`PATCH`). */
    update: (contactId: string, patch: ContactLinkPatch) =>
      run(() => updateContactLink(patientId, contactId, patch), t('contacts.current.updated')),
    /** Asks, then unlinks (`DELETE`); `focusAfter` once it is done (the row is gone). */
    remove: (row: ContactRowModel, focusAfter: () => void) => {
      confirm({
        title: t('contacts.current.removeTitle', { name: row.fullName }),
        body: t('contacts.current.removeBody', { name: row.fullName }),
        okLabel: t('contacts.current.removeOk'),
        tone: 'danger',
        onConfirm: async () => {
          let remaining: PatientContact[];
          try {
            remaining = await unlinkContact(patientId, row.key);
          } catch (error) {
            throw new Error(failed(error), { cause: error });
          }
          void settleContacts(queryClient, patientId, remaining);
          toast(t('contacts.current.removed'));
        },
        focusAfterConfirm: focusAfter,
      });
    },
  };
}

export type ContactActions = ReturnType<typeof useContactActions>;
