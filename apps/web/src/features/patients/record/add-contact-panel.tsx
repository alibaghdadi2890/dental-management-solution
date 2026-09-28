import type { Patient, Session } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { RightPanel } from '@/components/ui/right-panel';
import { todayIn } from '@/lib/format';
import { ContactDraftContext, type useContactDrafts } from '../contact-drafts';
import { ContactLinker, type StagedDefaults } from '../contact-linker';
import { linkExclusions } from '../contact-rows';
import { contactsQuery } from '../contacts-api';
import { LoadState } from '../panels/load-state';
import { minorOn } from '../patient-form';
import type { ContactActions } from '../use-contact-actions';

type Tenant = NonNullable<Session['tenant']>;

/** What a minor's contact starts as: a parent and guardian — for the first guardian also the
 * billing and emergency contact, as in the create panel's Guardian block. */
const minorDefaults = (hasGuardian: boolean): StagedDefaults => ({
  relationship: 'parent',
  roles: { guardian: true, billing: !hasGuardian, emergency: !hasGuardian },
});

/**
 * The record's Add contact panel (design addendum "Record"): the search-or-create picker, then the
 * relationship and the three role checkboxes (at least one). A pick is linked at once (C5); on
 * success a toast confirms it, the panel closes and focus returns to Add contact. A pick the server
 * refuses stays staged, with the reason in a toast. A staged pick or a new contact being typed is
 * unsaved (`drafts`, the record's): the Patient information tab's guard then asks before the
 * panel closes. `actions` are the record's one set of contact actions, shared with the Contacts
 * & family card.
 */
export function AddContactPanel({
  patient,
  tenant,
  actions,
  drafts,
  onClose,
}: {
  patient: Patient;
  tenant: Tenant;
  actions: ContactActions;
  drafts: ReturnType<typeof useContactDrafts>;
  onClose: () => void;
}) {
  const { t } = useTranslation(['patients', 'common']);
  const contacts = useQuery(contactsQuery(patient.id));
  const { busy, add } = actions;
  // Once the contact is added and the pick has cleared (nothing left to lose), the panel closes.
  const [added, setAdded] = useState(false);
  const closed = useRef(false);
  useEffect(() => {
    if (!added || drafts.dirty || closed.current) return;
    closed.current = true;
    onClose();
  }, [added, drafts.dirty, onClose]);
  const links = contacts.data ?? [];
  const exclusions = linkExclusions(patient.id, links);
  const hasGuardian = links.some((link) => link.isGuardian);
  const minor = minorOn(patient.dateOfBirth, todayIn(tenant.timeZone));

  return (
    <RightPanel
      eyebrow={patient.fullName}
      title={t('contacts.addPanel.title')}
      dirty={drafts.dirty}
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <Button disabled={busy} onClick={onClose}>
          {t('common:cancel')}
        </Button>
      }
    >
      {contacts.isError && (
        <LoadState
          error
          failed={t('contacts.current.failed')}
          onRetry={() => void contacts.refetch()}
        />
      )}
      <ContactDraftContext value={drafts.report}>
        <ContactLinker
          mode="family"
          country={tenant.country}
          hasGuardian={hasGuardian}
          excludeContactIds={exclusions.contactIds}
          excludePatientIds={exclusions.patientIds}
          disabled={busy || !contacts.isSuccess}
          stagedDefaults={minor ? minorDefaults(hasGuardian) : undefined}
          onAdd={async (link) => {
            if (!(await add(link))) return false;
            setAdded(true);
            return true;
          }}
        />
      </ContactDraftContext>
    </RightPanel>
  );
}
