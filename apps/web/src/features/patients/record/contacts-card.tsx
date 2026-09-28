import type { Patient, Session } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { usePermission } from '@/features/auth/use-permission';
import { todayIn } from '@/lib/format';
import { ContactRoleEditor } from '../contact-role-editor';
import { ContactRow } from '../contact-row';
import { type ContactRowModel, PRIMARY_FIELD, rowOfLink } from '../contact-rows';
import { contactsQuery } from '../contacts-api';
import { NoGuardianNote } from '../panels/contacts-section';
import { LoadState } from '../panels/load-state';
import { minorOn } from '../patient-form';
import { usePatientNavigation } from '../patient-navigation';
import type { ContactActions } from '../use-contact-actions';

type Tenant = NonNullable<Session['tenant']>;

/** A contact row's ⋯ menu: Edit roles, Remove, then Open record for a contact who is a patient.
 * Closing it after Edit roles leaves focus on the editor that opened, not on the ⋯ button. */
function ContactMenu({
  row,
  disabled,
  onEdit,
  onRemove,
  onOpenRecord,
}: {
  row: ContactRowModel;
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onOpenRecord: (() => void) | null;
}) {
  const { t } = useTranslation('patients');
  const keepFocus = useRef(false);
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton
          aria-label={t('contacts.card.menu', { name: row.fullName })}
          data-contact-menu={row.key}
          disabled={disabled}
          className="disabled:cursor-default disabled:opacity-45"
        >
          <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="3.5" cy="8" r="1.3" />
            <circle cx="8" cy="8" r="1.3" />
            <circle cx="12.5" cy="8" r="1.3" />
          </svg>
        </IconButton>
      </MenuTrigger>
      <MenuContent
        onCloseAutoFocus={(event) => {
          if (!keepFocus.current) return;
          keepFocus.current = false;
          event.preventDefault();
        }}
      >
        <MenuItem
          onSelect={() => {
            keepFocus.current = true;
            onEdit();
          }}
        >
          {t('contacts.card.editRoles')}
        </MenuItem>
        <MenuItem tone="danger" onSelect={onRemove}>
          {t('contacts.card.remove')}
        </MenuItem>
        {onOpenRecord && (
          <MenuItem
            onSelect={() => {
              keepFocus.current = true;
              onOpenRecord();
            }}
          >
            {t('contacts.card.openRecord')}
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  );
}

/**
 * The Patient information tab's Contacts & family card (design addendum "Record"): one row per
 * contact — avatar · name · relationship · role pills (the primary of each role marked) · Mono
 * phone — with a ⋯ menu (Edit roles opens the role editor beneath the row; Remove asks, then
 * unlinks; Open record for a contact who is a patient). Each action applies at once (C5), one at a
 * time; afterwards focus returns to the row's ⋯, or — the row gone — the next row's, else Add
 * contact. "No contacts recorded" when there is none; a minor with no guardian gets the amber note
 * instead. Add contact (`onAdd`) opens the record's Add contact panel. `actions` are the record's
 * one set of contact actions, shared with that panel, so one runs at a time across both.
 *
 * Read-only — no menus, no Add contact — without `patient:write`, and for an archived (or merged)
 * record, whose contacts the server won't change.
 */
export function ContactsCard({
  patient,
  tenant,
  actions,
  onAdd,
}: {
  patient: Patient;
  tenant: Tenant;
  actions: ContactActions;
  onAdd: () => void;
}) {
  const { t } = useTranslation('patients');
  const canWrite = usePermission('patient:write');
  const { openPatient } = usePatientNavigation();
  const contacts = useQuery(contactsQuery(patient.id));
  const { busy, update, remove } = actions;
  const [editing, setEditing] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const actionable = canWrite && patient.archivedAt === null;
  const minor = minorOn(patient.dateOfBirth, todayIn(tenant.timeZone));
  const links = contacts.data ?? [];
  const keys = links.map((link) => link.contact.id);
  // The contact being edited is gone (removed here or elsewhere): so is its editor.
  if (editing !== null && contacts.isSuccess && !keys.includes(editing)) setEditing(null);

  /** Focus a row's ⋯ once the list shows the change — or, for null, Add contact. */
  const focusRow = (key: string | null) => {
    requestAnimationFrame(() => {
      const selector = key === null ? '[data-contacts-add]' : `[data-contact-menu="${key}"]`;
      boxRef.current?.querySelector<HTMLElement>(selector)?.focus();
    });
  };

  let body;
  if (!contacts.isSuccess) {
    body = (
      <LoadState
        error={contacts.isError}
        failed={t('contacts.current.failed')}
        onRetry={() => void contacts.refetch()}
      />
    );
  } else {
    const noGuardian = minor && !links.some((link) => link.isGuardian);
    body = (
      <>
        {/* Announced as it comes and goes: adding or removing a guardian changes it. */}
        <div aria-live="polite">{noGuardian && <NoGuardianNote hint={false} />}</div>
        {links.length > 0 ? (
          <ul aria-label={t('contacts.list')} className="m-0 list-none p-0">
            {links.map((link) => {
              const row = rowOfLink(link);
              const linkedId = link.contact.linkedPatient?.id ?? null;
              return (
                <ContactRow
                  key={row.key}
                  row={row}
                  country={tenant.country}
                  patientLink
                  actions={
                    actionable && (
                      <ContactMenu
                        row={row}
                        disabled={busy}
                        onEdit={() => {
                          setEditing(row.key);
                        }}
                        onRemove={() => {
                          const next = keys[keys.indexOf(row.key) + 1] ?? null;
                          remove(row, () => {
                            focusRow(next);
                          });
                        }}
                        onOpenRecord={
                          linkedId === null
                            ? null
                            : () => {
                                openPatient(linkedId);
                              }
                        }
                      />
                    )
                  }
                >
                  {actionable && editing === row.key && (
                    <ContactRoleEditor
                      row={row}
                      disabled={false}
                      busy={busy}
                      onCancel={() => {
                        setEditing(null);
                        focusRow(row.key);
                      }}
                      onApply={(change) => {
                        void update(row.key, change).then((applied) => {
                          if (!applied) return;
                          setEditing(null);
                          focusRow(row.key);
                        });
                      }}
                      onMakePrimary={(role) => {
                        void update(row.key, { [PRIMARY_FIELD[role]]: true });
                      }}
                    />
                  )}
                </ContactRow>
              );
            })}
          </ul>
        ) : (
          !noGuardian && (
            <p className="m-0 text-[12.5px] leading-snug text-ink-muted">
              {t('contacts.card.empty')}
            </p>
          )
        )}
      </>
    );
  }

  return (
    <div ref={boxRef}>
      <Card
        title={t('contacts.card.title')}
        className="px-[22px] py-5"
        action={
          actionable && (
            <Button size="sm" data-contacts-add onClick={onAdd}>
              {t('contacts.card.add')}
            </Button>
          )
        }
      >
        <div className="flex flex-col gap-2.5">{body}</div>
      </Card>
    </div>
  );
}
