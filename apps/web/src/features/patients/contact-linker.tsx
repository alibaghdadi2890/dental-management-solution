import type { ContactLinkInput, ContactRelationship } from '@dcm/contracts';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ContactPicker, type ContactSelection, RelationshipSelect } from './contact-picker';
import { ContactIdentity, RoleCheckboxes, Toggle } from './contact-row';
import { hasRole, NO_ROLES, type RoleFlags, roleFields } from './contact-rows';
import { type ContactDisplay, guardianLink } from './patient-form';

/**
 * Which block the linker serves (design addendum "Create panel"): the minor's Guardian block —
 * every contact added is a guardian, with the "Also billing / emergency contact" toggles — or the
 * adult's "Contacts & family", where the person picks the roles (at least one).
 */
export type LinkerMode = 'guardian' | 'family';

interface Staged {
  selection: ContactSelection;
  relationship: ContactRelationship;
  roles: RoleFlags;
}

/** The relationship a contact starts with: a minor's guardian is most often a parent; an adult's
 * contact is anyone, so nothing is presumed ("Other"). */
const DEFAULT_RELATIONSHIP: Record<LinkerMode, ContactRelationship> = {
  guardian: 'parent',
  family: 'other',
};

/**
 * Adds a contact to a patient: the search-or-create picker, then what the link needs before it is
 * made. In the Guardian block a new contact (which already carries its relationship) is added at
 * once; an existing contact or patient is staged first for its relationship. The two toggles are
 * on for the first guardian and off for any further one (a second guardian is rarely also who pays
 * or who to call first), and go back to that default after each add. In "Contacts & family" every
 * pick is staged: relationship and roles, none pre-checked, and Add waits for one.
 *
 * `onAdd` makes the link — into the create's pending list (synchronously), or through the API (the
 * edit panel) — and answers whether it was made; a refused one stays staged to try again.
 */
export function ContactLinker({
  mode,
  country,
  hasGuardian,
  excludeContactIds,
  excludePatientIds,
  disabled = false,
  onAdd,
}: {
  mode: LinkerMode;
  country: string;
  /** A guardian is already linked or pending: the toggles then start off. */
  hasGuardian: boolean;
  excludeContactIds: readonly string[];
  excludePatientIds: readonly string[];
  disabled?: boolean;
  onAdd: (link: ContactLinkInput, display: ContactDisplay) => boolean | Promise<boolean>;
}) {
  const { t } = useTranslation(['patients', 'common']);
  const containerRef = useRef<HTMLDivElement>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [toggles, setToggles] = useState<{ billing: boolean; emergency: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const guardianRoles = toggles ?? { billing: !hasGuardian, emergency: !hasGuardian };
  const off = disabled || busy;

  /** Back to the search box, which mounts again once the staged contact is gone. */
  const focusSearch = () => {
    requestAnimationFrame(() => {
      containerRef.current?.querySelector<HTMLInputElement>('[role="combobox"]')?.focus();
    });
  };

  const add = async (link: ContactLinkInput, display: ContactDisplay): Promise<boolean> => {
    setBusy(true);
    try {
      if (!(await onAdd(link, display))) return false;
      setStaged(null);
      setToggles(null);
      return true;
    } finally {
      setBusy(false);
    }
  };

  const linkOf = ({ selection, relationship, roles }: Staged): ContactLinkInput =>
    mode === 'guardian'
      ? guardianLink(selection.target, relationship, guardianRoles)
      : { target: selection.target, relationship, ...roleFields(roles) };

  const onSelect = (selection: ContactSelection) => {
    if (mode === 'guardian' && selection.relationship !== null) {
      void add(
        guardianLink(selection.target, selection.relationship, guardianRoles),
        selection.display,
      );
      return;
    }
    setStaged({
      selection,
      relationship: selection.relationship ?? DEFAULT_RELATIONSHIP[mode],
      roles: NO_ROLES,
    });
  };

  const cancel = () => {
    setStaged(null);
    focusSearch();
  };

  return (
    <div ref={containerRef} className="flex flex-col gap-2.5">
      {staged ? (
        <StagedContact
          staged={staged}
          mode={mode}
          country={country}
          disabled={off}
          busy={busy}
          onChange={setStaged}
          onCancel={cancel}
          onConfirm={() => {
            void add(linkOf(staged), staged.selection.display).then((added) => {
              if (added) focusSearch();
            });
          }}
        />
      ) : (
        <ContactPicker
          label={t(mode === 'guardian' ? 'contacts.guardian.search' : 'contacts.family.search')}
          placeholder={mode === 'guardian' ? undefined : t('contacts.picker.searchContact')}
          country={country}
          excludeContactIds={excludeContactIds}
          excludePatientIds={excludePatientIds}
          defaultRelationship={DEFAULT_RELATIONSHIP[mode]}
          disabled={off}
          onSelect={onSelect}
        />
      )}
      {mode === 'guardian' && (
        <fieldset className="m-0 flex flex-wrap gap-x-4 gap-y-2 border-0 p-0">
          <legend className="sr-only">{t('contacts.guardian.roles')}</legend>
          <Toggle
            label={t('contacts.guardian.alsoBilling')}
            checked={guardianRoles.billing}
            disabled={off}
            onChange={(billing) => {
              setToggles({ ...guardianRoles, billing });
            }}
          />
          <Toggle
            label={t('contacts.guardian.alsoEmergency')}
            checked={guardianRoles.emergency}
            disabled={off}
            onChange={(emergency) => {
              setToggles({ ...guardianRoles, emergency });
            }}
          />
        </fieldset>
      )}
    </div>
  );
}

/** A picked contact waiting for its relationship (and, in "Contacts & family", its roles). Opens
 * with the relationship focused; Escape cancels here, leaving the panel open. */
function StagedContact({
  staged,
  mode,
  country,
  disabled,
  busy,
  onChange,
  onCancel,
  onConfirm,
}: {
  staged: Staged;
  mode: LinkerMode;
  country: string;
  disabled: boolean;
  busy: boolean;
  onChange: (staged: Staged) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation(['patients', 'common']);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    boxRef.current?.querySelector('select')?.focus();
  }, []);
  const needsRole = mode === 'family' && !hasRole(staged.roles);
  const { display } = staged.selection;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onCancel();
  };

  return (
    <div
      ref={boxRef}
      role="group"
      aria-label={display.fullName}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3 rounded-lg border border-border bg-faint p-3"
    >
      <ContactIdentity display={display} country={country} />
      <Field label={t('contacts.relationship')}>
        {(props) => (
          <RelationshipSelect
            {...props}
            disabled={disabled}
            value={staged.relationship}
            onChange={(relationship) => {
              onChange({ ...staged, relationship });
            }}
          />
        )}
      </Field>
      {mode === 'family' && (
        <RoleCheckboxes
          roles={staged.roles}
          disabled={disabled}
          hint={needsRole ? t('contacts.family.roleHint') : undefined}
          onChange={(roles) => {
            onChange({ ...staged, roles });
          }}
        />
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" disabled={busy} onClick={onCancel}>
          {t('common:cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          busy={busy}
          disabled={disabled || needsRole}
          onClick={onConfirm}
        >
          {t(mode === 'guardian' ? 'contacts.guardian.add' : 'contacts.family.add')}
        </Button>
      </div>
    </div>
  );
}
