import { type Patient, PATIENT_CREATE_CONTACTS_MAX } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, type RefObject, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ContactLinker } from '../contact-linker';
import type { ContactSelection } from '../contact-picker';
import { ContactRoleEditor, type LinkChange } from '../contact-role-editor';
import { ContactRow } from '../contact-row';
import {
  type ContactRole,
  type ContactRowModel,
  linkExclusions,
  PRIMARY_FIELD,
  rowOfLink,
  rowOfPending,
} from '../contact-rows';
import { contactsQuery } from '../contacts-api';
import { contactErrorField, pendingExclusions } from '../patient-form';
import { useContactActions } from '../use-contact-actions';
import type { PatientForm } from '../use-patient-form';
import { LoadState } from './load-state';

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
 * opened once there is one, and from then on open or closed as the person leaves it (removing the
 * last contact never closes it under them). `bodyRef` holds the rows and the picker.
 */
function ContactsBlock({
  minor,
  count,
  hasGuardian,
  bodyRef,
  children,
}: {
  minor: boolean;
  count: number;
  hasGuardian: boolean;
  bodyRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const { t } = useTranslation('patients');
  const headingId = useId();
  const regionId = useId();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  if (expanded === null && count > 0) setExpanded(true);
  const open = expanded ?? false;

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
        <div ref={bodyRef} className="flex flex-col gap-2.5">
          {children}
        </div>
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
      <div ref={bodyRef} id={regionId} hidden={!open} className="flex flex-col gap-2.5">
        {children}
      </div>
    </section>
  );
}

/**
 * Where focus goes after a row action: back to a row's Edit button (after its editor applied or
 * cancelled), or — the row gone — the next row's Edit, else the picker's search box. Waits a frame
 * for the list to render the change.
 */
function useRowFocus() {
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusRow = (key: string | null) => {
    requestAnimationFrame(() => {
      const body = bodyRef.current;
      const target =
        key === null
          ? body?.querySelector<HTMLElement>('input[role="combobox"]')
          : body?.querySelector<HTMLElement>(`[data-contact-edit="${key}"]`);
      target?.focus();
    });
  };
  /** The row after `key` in `keys`, or null (the picker) for the last. */
  const after = (keys: readonly string[], key: string) => keys[keys.indexOf(key) + 1] ?? null;
  return { bodyRef, focusRow, after };
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
        data-contact-edit={row.key}
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
 * to a note. `guardianRequest` stages a contact in the Guardian block (the phone offer, C4).
 */
export function PendingContactsSection({
  form,
  country,
  guardianRequest,
}: {
  form: PatientForm;
  country: string;
  guardianRequest: ContactSelection | null;
}) {
  const { t } = useTranslation('patients');
  const { values } = form;
  const [editing, setEditing] = useState<string | null>(null);
  const { bodyRef, focusRow, after } = useRowFocus();
  const pending = values.pendingContacts;
  const minor = form.showGuardianBlock;
  const hasGuardian = pending.some(({ link }) => link.isGuardian);
  const exclusions = pendingExclusions(values);
  const keys = pending.map(({ key }) => key);

  return (
    <ContactsBlock minor={minor} count={pending.length} hasGuardian={hasGuardian} bodyRef={bodyRef}>
      {pending.length > 0 && (
        <ul aria-label={t('contacts.list')} className="m-0 list-none p-0">
          {pending.map((contact, index) => {
            const row = rowOfPending(contact);
            const closeEditor = () => {
              setEditing(null);
              focusRow(contact.key);
            };
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
                      focusRow(after(keys, contact.key));
                    }}
                  />
                }
              >
                {editing === contact.key && (
                  <ContactRoleEditor
                    row={row}
                    disabled={false}
                    onCancel={closeEditor}
                    onApply={(change) => {
                      form.updateContact(contact.key, change);
                      closeEditor();
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
          request={minor ? guardianRequest : null}
          onAdd={(link, display) => form.addContact(link, display)}
        />
      )}
    </ContactsBlock>
  );
}

/**
 * The edit panel's contacts (design addendum C5): the patient's current links, whose changes apply
 * at once through the contact routes — add, change relationship or roles, make primary, remove
 * (after a confirm) — each with a toast, never part of Save. One action at a time: the others wait
 * while it runs. An archived (or merged) patient's contacts can't change: the server refuses, so
 * the actions are off.
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
  const { t } = useTranslation('patients');
  const contacts = useQuery(contactsQuery(patient.id));
  const [editing, setEditing] = useState<string | null>(null);
  const { busy, add, update, remove } = useContactActions(patient.id);
  const { bodyRef, focusRow, after } = useRowFocus();
  const archived = patient.archivedAt !== null;
  const links = contacts.data ?? [];
  const hasGuardian = links.some((link) => link.isGuardian);
  const keys = links.map((link) => link.contact.id);

  const apply = (contactId: string, change: LinkChange) => {
    void update(contactId, change).then((applied) => {
      if (!applied) return;
      setEditing(null);
      focusRow(contactId);
    });
  };

  const makePrimary = (contactId: string, role: ContactRole) => {
    void update(contactId, { [PRIMARY_FIELD[role]]: true });
  };

  const exclusions = linkExclusions(patient.id, links);

  let list: ReactNode = null;
  if (!contacts.isSuccess) {
    list = (
      <LoadState
        error={contacts.isError}
        failed={t('contacts.current.failed')}
        onRetry={() => void contacts.refetch()}
      />
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
                    const next = after(keys, row.key);
                    remove(row, () => {
                      focusRow(next);
                    });
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
                    focusRow(row.key);
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
      bodyRef={bodyRef}
    >
      {list}
      <ContactLinker
        mode={minor ? 'guardian' : 'family'}
        country={country}
        hasGuardian={hasGuardian}
        excludeContactIds={exclusions.contactIds}
        excludePatientIds={exclusions.patientIds}
        disabled={archived || busy || !contacts.isSuccess}
        onAdd={add}
      />
    </ContactsBlock>
  );
}
