import {
  type ContactLinkInput,
  type Patient,
  PATIENT_CREATE_CONTACTS_MAX,
  type PatientContact,
} from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { SHIMMER } from '@/components/ui/list';
import { useToast } from '@/components/ui/toast-context';
import { cn } from '@/lib/utils';
import { ContactLinker } from '../contact-linker';
import { ContactRoleEditor, type LinkChange } from '../contact-role-editor';
import { ContactRow } from '../contact-row';
import {
  type ContactRole,
  type ContactRowModel,
  PRIMARY_FIELD,
  rowOfLink,
  rowOfPending,
} from '../contact-rows';
import {
  contactsQuery,
  linkContact,
  settleContacts,
  unlinkContact,
  updateContactLink,
} from '../contacts-api';
import { contactErrorField, pendingExclusions } from '../patient-form';
import type { PatientForm } from '../use-patient-form';
import { FAILURE_VALUES, failureOf } from './form-server-errors';

/** The amber "No guardian recorded" note (design tokens: warning bg/border/fg): a minor may be
 * saved without one, so it informs, never blocks. */
export function NoGuardianNote({ hint = true }: { hint?: boolean }) {
  const { t } = useTranslation('patients');
  return (
    <p className="m-0 rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-[12.5px] leading-[1.45] text-warning">
      <b className="font-semibold">{t('contacts.guardian.none')}</b>
      {hint && (
        <span className="block text-[11.5px] leading-snug">{t('contacts.guardian.noneHint')}</span>
      )}
    </p>
  );
}

/**
 * Where a patient form shows its contacts (design addendum "Create panel"): for a minor the
 * Guardian block, headed and always open, with the amber note while no contact is a guardian; for
 * an adult the "Contacts & family (optional)" disclosure — collapsed while there is no contact,
 * open once there is one, unless the person closed it.
 */
function ContactsBlock({
  minor,
  count,
  hasGuardian,
  children,
}: {
  minor: boolean;
  count: number;
  hasGuardian: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation('patients');
  const headingId = useId();
  const regionId = useId();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? count > 0;

  if (minor) {
    return (
      <section
        aria-labelledby={headingId}
        className="flex flex-col gap-2.5 rounded-[9px] border border-border p-3"
      >
        <h3 id={headingId} className="m-0 text-[13px] leading-none font-semibold">
          {t('contacts.guardian.title')}
        </h3>
        {!hasGuardian && <NoGuardianNote />}
        {children}
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => {
          setExpanded(!open);
        }}
        className="flex cursor-pointer items-center gap-1.5 self-start border-0 bg-transparent p-0 text-[12.5px] leading-none font-medium text-primary hover:underline"
      >
        <svg
          aria-hidden
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={cn(
            'transition-transform rtl:-scale-x-100',
            open && 'rotate-90 rtl:-rotate-90',
          )}
        >
          <path d="M3.5 2 7 5 3.5 8" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        {t('contacts.family.toggle')}
      </button>
      <div id={regionId} hidden={!open} className="flex flex-col gap-2.5">
        {children}
      </div>
    </section>
  );
}

function RowActions({
  row,
  disabled,
  onEdit,
  onRemove,
}: {
  row: ContactRowModel;
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('patients');
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5"
        disabled={disabled}
        aria-label={t('contacts.row.editNamed', { name: row.fullName })}
        onClick={onEdit}
      >
        {t('contacts.row.edit')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-danger"
        disabled={disabled}
        aria-label={t('contacts.row.removeNamed', { name: row.fullName })}
        onClick={onRemove}
      >
        {t('contacts.row.remove')}
      </Button>
    </>
  );
}

/**
 * The create panel's contacts: the links that go with the create (`pendingContacts`, design
 * addendum C4). Each row can be edited (relationship, roles) or removed before saving; the server's
 * error about one (`contacts.<i>`) shows on its row. At the create's cap (10) the picker gives way
 * to a note.
 */
export function PendingContactsSection({ form, country }: { form: PatientForm; country: string }) {
  const { t } = useTranslation('patients');
  const { values } = form;
  const [editing, setEditing] = useState<string | null>(null);
  const pending = values.pendingContacts;
  const minor = form.showGuardianBlock;
  const hasGuardian = pending.some(({ link }) => link.isGuardian);
  const exclusions = pendingExclusions(values);

  return (
    <ContactsBlock minor={minor} count={pending.length} hasGuardian={hasGuardian}>
      {pending.length > 0 && (
        <ul aria-label={t('contacts.list')} className="m-0 list-none p-0">
          {pending.map((contact, index) => {
            const row = rowOfPending(contact);
            return (
              <ContactRow
                key={contact.key}
                row={row}
                country={country}
                error={form.messageOf(contactErrorField(index))}
                actions={
                  <RowActions
                    row={row}
                    disabled={false}
                    onEdit={() => {
                      setEditing(editing === contact.key ? null : contact.key);
                    }}
                    onRemove={() => {
                      form.removeContact(contact.key);
                    }}
                  />
                }
              >
                {editing === contact.key && (
                  <ContactRoleEditor
                    row={row}
                    disabled={false}
                    onCancel={() => {
                      setEditing(null);
                    }}
                    onApply={(change) => {
                      form.updateContact(contact.key, change);
                      setEditing(null);
                    }}
                  />
                )}
              </ContactRow>
            );
          })}
        </ul>
      )}
      {pending.length >= PATIENT_CREATE_CONTACTS_MAX ? (
        <p className="m-0 text-xs leading-snug text-ink-muted">
          {t('contacts.tooMany', { max: PATIENT_CREATE_CONTACTS_MAX })}
        </p>
      ) : (
        <ContactLinker
          mode={minor ? 'guardian' : 'family'}
          country={country}
          hasGuardian={hasGuardian}
          excludeContactIds={exclusions.contactIds}
          excludePatientIds={exclusions.patientIds}
          onAdd={(link, display) => {
            form.addContact(link, display);
            return true;
          }}
        />
      )}
    </ContactsBlock>
  );
}

/**
 * The edit panel's contacts (design addendum C5): the patient's current links, whose changes apply
 * at once through the contact routes — add, change relationship or roles, make primary, remove
 * (after a confirm) — each with a toast, never part of Save. An archived (or merged) patient's
 * contacts can't change: the server refuses, so the actions are off.
 */
export function CurrentContactsSection({
  patient,
  minor,
  country,
}: {
  patient: Patient;
  minor: boolean;
  country: string;
}) {
  const { t } = useTranslation(['patients', 'common']);
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const contacts = useQuery(contactsQuery(patient.id));
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const archived = patient.archivedAt !== null;
  const links = contacts.data ?? [];
  const hasGuardian = links.some((link) => link.isGuardian);

  const failed = (error: unknown) =>
    t('contacts.current.actionFailed', {
      reason: t(`failures.${failureOf(error)}`, FAILURE_VALUES),
    });

  /** Runs one contact action; true once it applied. */
  const run = async (action: () => Promise<PatientContact[]>, done: string) => {
    setBusy(true);
    try {
      void settleContacts(queryClient, patient.id, await action());
      toast(done);
      return true;
    } catch (error) {
      toast(failed(error), { tone: 'danger' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = (link: ContactLinkInput) =>
    run(() => linkContact(patient.id, link), t('contacts.current.added'));

  const apply = (contactId: string, change: LinkChange) => {
    void run(
      () => updateContactLink(patient.id, contactId, change),
      t('contacts.current.updated'),
    ).then((applied) => {
      if (applied) setEditing(null);
    });
  };

  const makePrimary = (contactId: string, role: ContactRole) => {
    void run(
      () => updateContactLink(patient.id, contactId, { [PRIMARY_FIELD[role]]: true }),
      t('contacts.current.updated'),
    );
  };

  const remove = (row: ContactRowModel) => {
    confirm({
      title: t('contacts.current.removeTitle', { name: row.fullName }),
      body: t('contacts.current.removeBody', { name: row.fullName }),
      okLabel: t('contacts.current.removeOk'),
      tone: 'danger',
      onConfirm: async () => {
        let remaining: PatientContact[];
        try {
          remaining = await unlinkContact(patient.id, row.key);
        } catch (error) {
          throw new Error(failed(error), { cause: error });
        }
        void settleContacts(queryClient, patient.id, remaining);
        toast(t('contacts.current.removed'));
      },
    });
  };

  const excludeContactIds = links.map((link) => link.contact.id);
  const excludePatientIds = [
    patient.id,
    ...links.flatMap((link) => (link.contact.linkedPatient ? [link.contact.linkedPatient.id] : [])),
  ];

  let list: ReactNode = null;
  if (contacts.isPending) {
    list = (
      <span
        role="status"
        aria-label={t('contacts.current.loading')}
        className={cn('block h-9 w-full', SHIMMER)}
      />
    );
  } else if (contacts.isError) {
    list = (
      <div role="alert" className="flex items-center gap-2">
        <span className="text-[12.5px] leading-snug text-ink-secondary">
          {t('contacts.current.failed')}
        </span>
        <Button variant="ghost" size="sm" className="px-0" onClick={() => void contacts.refetch()}>
          {t('common:tryAgain')}
        </Button>
      </div>
    );
  } else if (links.length > 0) {
    list = (
      <ul aria-label={t('contacts.list')} className="m-0 list-none p-0">
        {links.map((link) => {
          const row = rowOfLink(link);
          return (
            <ContactRow
              key={row.key}
              row={row}
              country={country}
              actions={
                <RowActions
                  row={row}
                  disabled={archived || busy}
                  onEdit={() => {
                    setEditing(editing === row.key ? null : row.key);
                  }}
                  onRemove={() => {
                    remove(row);
                  }}
                />
              }
            >
              {editing === row.key && !archived && (
                <ContactRoleEditor
                  row={row}
                  disabled={archived}
                  busy={busy}
                  onCancel={() => {
                    setEditing(null);
                  }}
                  onApply={(change) => {
                    apply(row.key, change);
                  }}
                  onMakePrimary={(role) => {
                    makePrimary(row.key, role);
                  }}
                />
              )}
            </ContactRow>
          );
        })}
      </ul>
    );
  }

  return (
    <ContactsBlock
      minor={minor}
      count={links.length}
      hasGuardian={hasGuardian || !contacts.isSuccess}
    >
      {list}
      <ContactLinker
        mode={minor ? 'guardian' : 'family'}
        country={country}
        hasGuardian={hasGuardian}
        excludeContactIds={excludeContactIds}
        excludePatientIds={excludePatientIds}
        disabled={archived || !contacts.isSuccess}
        onAdd={add}
      />
    </ContactsBlock>
  );
}
