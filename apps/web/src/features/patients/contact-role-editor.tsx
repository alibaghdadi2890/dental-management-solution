import type { ContactRelationship } from '@dcm/contracts';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { useContactDraft } from './contact-drafts';
import { RelationshipSelect } from './contact-picker';
import { RoleCheckboxes } from './contact-row';
import {
  CONTACT_ROLES,
  type ContactRole,
  type ContactRowModel,
  hasRole,
  ROLE_FIELD,
  type RoleFlags,
} from './contact-rows';

/** What an edit of a link changes: only what differs from the row (a `ContactLinkPatch` without
 * primaries, and a pending link's `updatePendingContact` patch alike). */
export interface LinkChange {
  relationship?: ContactRelationship;
  isGuardian?: boolean;
  isBillingContact?: boolean;
  isEmergencyContact?: boolean;
}

const MAKE_PRIMARY = {
  guardian: 'contacts.editor.makePrimaryGuardian',
  billing: 'contacts.editor.makePrimaryBilling',
  emergency: 'contacts.editor.makePrimaryEmergency',
} as const satisfies Record<ContactRole, string>;

function changeOf(row: ContactRowModel, relationship: ContactRelationship, roles: RoleFlags) {
  const change: LinkChange = {};
  if (relationship !== row.relationship) change.relationship = relationship;
  for (const role of CONTACT_ROLES) {
    if (roles[role] !== row.roles[role]) change[ROLE_FIELD[role]] = roles[role];
  }
  return change;
}

/**
 * A contact row's inline editor ("Roles of {name}"): the relationship and the three roles, applied
 * together (only what changed; at least one role stays). For a saved link it also shows each held
 * role's primary: "Primary", or "Make primary", which applies at once (`onMakePrimary`) — a role
 * must be saved before its holder can become its primary. Opens with the relationship focused;
 * Escape cancels here, leaving the panel open. Changes not yet applied count as unsaved.
 */
export function ContactRoleEditor({
  row,
  disabled,
  busy = false,
  onApply,
  onMakePrimary,
  onCancel,
}: {
  row: ContactRowModel;
  disabled: boolean;
  busy?: boolean;
  onApply: (change: LinkChange) => void;
  onMakePrimary?: (role: ContactRole) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(['patients', 'common']);
  const boxRef = useRef<HTMLDivElement>(null);
  const [relationship, setRelationship] = useState(row.relationship);
  const [roles, setRoles] = useState(row.roles);
  useEffect(() => {
    boxRef.current?.querySelector('select')?.focus();
  }, []);
  const change = changeOf(row, relationship, roles);
  useContactDraft(Object.keys(change).length > 0, 'roles');
  const off = disabled || busy;
  const { primary } = row;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onCancel();
  };

  const primaryControl = (role: ContactRole) => {
    if (primary === null || !row.roles[role]) return null;
    if (primary[role]) {
      return (
        <span className="text-xs leading-none font-medium text-ink-muted">
          {t('contacts.editor.primary')}
        </span>
      );
    }
    if (!onMakePrimary) return null;
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-0 text-xs"
        disabled={off}
        aria-label={t(MAKE_PRIMARY[role], { name: row.fullName })}
        onClick={() => {
          onMakePrimary(role);
        }}
      >
        {t('contacts.editor.makePrimary')}
      </Button>
    );
  };

  return (
    <div
      ref={boxRef}
      role="group"
      aria-label={t('contacts.editor.title', { name: row.fullName })}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3 rounded-lg border border-border bg-faint p-3"
    >
      <Field label={t('contacts.relationship')}>
        {(props) => (
          <RelationshipSelect
            {...props}
            disabled={off}
            value={relationship}
            onChange={setRelationship}
          />
        )}
      </Field>
      <RoleCheckboxes
        roles={roles}
        disabled={off}
        onChange={setRoles}
        extra={primaryControl}
        hint={hasRole(roles) ? undefined : t('contacts.family.roleHint')}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" disabled={busy} onClick={onCancel}>
          {t('common:cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          busy={busy}
          disabled={disabled || Object.keys(change).length === 0 || !hasRole(roles)}
          onClick={() => {
            onApply(change);
          }}
        >
          {t('contacts.editor.apply')}
        </Button>
      </div>
    </div>
  );
}
