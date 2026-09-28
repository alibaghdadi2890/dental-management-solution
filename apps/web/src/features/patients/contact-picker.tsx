import {
  CONTACT_RELATIONSHIPS,
  type ContactLinkTarget,
  type ContactLookupItem,
  type ContactRelationship,
  nameSchema,
  normalizePhone,
  toAsciiDigits,
} from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, type SelectHTMLAttributes, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, Select, TextInput } from '@/components/ui/field';
import { SearchIcon } from '@/components/ui/search-icon';
import { formatPhone } from '@/lib/format';
import { initials } from '@/lib/initials';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';
import { contactLookupQuery } from './contacts-api';
import type { ContactDisplay } from './patient-form';

const DEBOUNCE_MS = 200;
const MAX_QUERY = 100;

/** What the picker hands its parent: who to link, how they read, and — only for a contact made
 * in "Add new contact" — the relationship chosen there (for an existing contact or patient the
 * parent block asks for it). */
export interface ContactSelection {
  target: ContactLinkTarget;
  display: ContactDisplay;
  relationship: ContactRelationship | null;
}

/** The relationship `<select>`: the six relations of a contact *to the patient*, localized. */
export function RelationshipSelect({
  value,
  onChange,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> & {
  value: ContactRelationship;
  onChange: (relationship: ContactRelationship) => void;
}) {
  const { t } = useTranslation('patients');
  return (
    <Select
      {...props}
      value={value}
      onChange={(event) => {
        const picked = CONTACT_RELATIONSHIPS.find((option) => option === event.target.value);
        if (picked) onChange(picked);
      }}
    >
      {CONTACT_RELATIONSHIPS.map((relationship) => (
        <option key={relationship} value={relationship}>
          {t(`contacts.relationships.${relationship}`)}
        </option>
      ))}
    </Select>
  );
}

interface Row {
  key: string;
  target: ContactLinkTarget;
  display: ContactDisplay;
}

function rowOf(item: ContactLookupItem): Row {
  if (item.kind === 'contact') {
    const { contact } = item;
    return {
      key: `contact:${contact.id}`,
      target: { contactId: contact.id },
      display: {
        fullName: contact.fullName,
        phone: contact.phone,
        patientNumber: contact.linkedPatient?.displayNumber ?? null,
        archived: contact.linkedPatient?.archived ?? false,
      },
    };
  }
  const { patient } = item;
  return {
    key: `patient:${patient.id}`,
    target: { patientId: patient.id },
    display: {
      fullName: patient.fullName,
      phone: patient.phone,
      patientNumber: patient.displayNumber,
      archived: false,
    },
  };
}

function excluded(
  item: ContactLookupItem,
  contactIds: readonly string[],
  patientIds: readonly string[],
): boolean {
  if (item.kind === 'patient') return patientIds.includes(item.patient.id);
  const linked = item.contact.linkedPatient;
  return (
    contactIds.includes(item.contact.id) || (linked !== null && patientIds.includes(linked.id))
  );
}

/** A search that reads as a phone pre-fills the new contact's phone, anything else its name. */
const PHONE_LIKE = /^[\d\s()+-]+$/;

type PhoneCountry = Parameters<typeof normalizePhone>[1];

type NewContactError = 'required' | 'tooLong' | 'invalidPhone';

interface Draft {
  fullName: string;
  phone: string;
  relationship: ContactRelationship;
  checked: boolean;
}

function draftErrors(draft: Draft, country: string) {
  const errors: { fullName?: NewContactError; phone?: NewContactError } = {};
  if (draft.fullName.trim() === '') errors.fullName = 'required';
  else if (!nameSchema.safeParse(draft.fullName).success) errors.fullName = 'tooLong';
  if (draft.phone.trim() === '') errors.phone = 'required';
  else if (!normalizePhone(draft.phone, country as PhoneCountry)) errors.phone = 'invalidPhone';
  return errors;
}

const badge =
  'h-[18px] flex-none rounded-[4px] border px-1.5 text-[11.5px] leading-4 font-medium whitespace-nowrap';

/**
 * The search-or-create control (design addendum C5, "Frontend"): a 36px search box whose text is
 * looked up (`GET /contacts/lookup`, debounced) among contacts and patients who are nobody's
 * contact yet. Each hit reads avatar · name · phone, with a "Patient P-…" badge when it is (or is
 * linked to) a patient, and "Archived" for an archived one. ↑/↓ move, Enter or a click picks,
 * Escape clears the search (and does not close the panel around it). "Add new contact" reveals
 * name*, phone* (checked against the tenant's country) and relationship.
 *
 * `excludeContactIds`/`excludePatientIds` leave out who is already linked or pending, and the
 * patient itself. The picker never links anyone: `onSelect` hands the choice to its parent.
 */
export function ContactPicker({
  label,
  country,
  placeholder,
  excludeContactIds = [],
  excludePatientIds = [],
  defaultRelationship = 'parent',
  disabled = false,
  onSelect,
}: {
  /** The search box's accessible name (e.g. "Guardian"). */
  label: string;
  /** The tenant's country: phones are shown and checked against it. */
  country: string;
  /** Defaults to "Search a parent by name or phone…" (the Guardian block). */
  placeholder?: string;
  excludeContactIds?: readonly string[];
  excludePatientIds?: readonly string[];
  /** The relationship a new contact starts with. */
  defaultRelationship?: ContactRelationship;
  disabled?: boolean;
  onSelect: (selection: ContactSelection) => void;
}) {
  const { t } = useTranslation(['patients', 'common']);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${String(index)}`;
  const inputRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const typed = text.trim();
  const query = useDebouncedValue(typed, DEBOUNCE_MS);
  const lookup = useQuery(contactLookupQuery(query));
  const searching = typed !== '' && draft === null;
  const settled = typed === query && lookup.isSuccess;
  const rows = settled
    ? lookup.data.filter((item) => !excluded(item, excludeContactIds, excludePatientIds)).map(rowOf)
    : [];

  const [cursor, setCursor] = useState({ query, index: 0 });
  const active = cursor.query === query ? Math.min(cursor.index, rows.length - 1) : 0;
  const hasRows = searching && rows.length > 0;
  const failed = searching && typed === query && lookup.isError;
  const loading = searching && !settled && !failed;
  const noMatch = searching && settled && rows.length === 0;

  const pick = (row: Row) => {
    onSelect({ target: row.target, display: row.display, relationship: null });
    setText('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // An input method (Arabic, CJK…) uses Enter and the arrows for its own candidates.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- no standard replacement
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      if (text === '') return;
      event.preventDefault();
      setText('');
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!hasRows) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const index = Math.min(Math.max(active + step, 0), rows.length - 1);
      setCursor({ query, index });
      document.getElementById(optionId(index))?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (event.key !== 'Enter') return;
    // Never submits the form around the picker; picks only what answers the typed text.
    event.preventDefault();
    const row = hasRows ? rows[active] : undefined;
    if (row) pick(row);
  };

  const startDraft = () => {
    const ascii = toAsciiDigits(typed);
    const phoneLike = PHONE_LIKE.test(ascii) && /\d/.test(ascii);
    setDraft({
      fullName: phoneLike ? '' : typed,
      phone: phoneLike ? ascii : '',
      relationship: defaultRelationship,
      checked: false,
    });
  };

  if (draft) {
    return (
      <NewContactForm
        draft={draft}
        country={country}
        disabled={disabled}
        onChange={setDraft}
        onCancel={() => {
          setDraft(null);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        onConfirm={(selection) => {
          onSelect(selection);
          setDraft(null);
          setText('');
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <SearchIcon
          size={14}
          className="pointer-events-none absolute start-[11px] top-1/2 -translate-y-1/2 text-ink-muted"
        />
        <input
          ref={inputRef}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={hasRows}
          aria-controls={hasRows ? listId : undefined}
          aria-activedescendant={hasRows ? optionId(active) : undefined}
          value={text}
          maxLength={MAX_QUERY}
          disabled={disabled}
          placeholder={placeholder ?? t('contacts.picker.searchParent')}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={onKeyDown}
          className="h-9 w-full rounded-lg border border-border-control bg-surface ps-8 pe-[11px] text-[13px] leading-none text-ink placeholder:text-ink-muted"
        />
      </div>
      <div role="status" className="empty:hidden">
        {loading && <span className="sr-only">{t('contacts.picker.loading')}</span>}
        {hasRows && (
          <span className="sr-only">{t('contacts.picker.results', { count: rows.length })}</span>
        )}
        {noMatch && (
          <p className="m-0 px-1 text-[12.5px] leading-snug text-ink-muted">
            {t('contacts.picker.noResults', { query })}
          </p>
        )}
      </div>
      {failed && (
        <div role="alert" className="flex items-center gap-2 px-1">
          <span className="text-[12.5px] leading-snug text-ink-secondary">
            {t('contacts.picker.failed')}
          </span>
          <Button variant="ghost" size="sm" className="px-0" onClick={() => void lookup.refetch()}>
            {t('common:tryAgain')}
          </Button>
        </div>
      )}
      {hasRows && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="m-0 max-h-[252px] list-none overflow-y-auto rounded-lg border border-border bg-surface p-0 py-1"
        >
          {rows.map((row, index) => (
            <PickerRow
              key={row.key}
              id={optionId(index)}
              row={row}
              country={country}
              active={index === active}
              onHover={() => {
                if (index !== active) setCursor({ query, index });
              }}
              onPick={() => {
                pick(row);
              }}
            />
          ))}
        </ul>
      )}
      <div>
        <Button variant="ghost" size="sm" className="px-0" disabled={disabled} onClick={startDraft}>
          {t('contacts.picker.addNew')}
        </Button>
      </div>
    </div>
  );
}

function PickerRow({
  id,
  row,
  country,
  active,
  onHover,
  onPick,
}: {
  id: string;
  row: Row;
  country: string;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  const { t } = useTranslation('patients');
  const { display } = row;
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      onMouseMove={onHover}
      // Keeps focus in the search box, so the keyboard carries on from there.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onPick}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 px-3 py-1.5',
        active ? 'bg-primary-tint/60' : 'bg-surface',
      )}
    >
      <span
        aria-hidden
        className="grid size-7 flex-none place-items-center rounded-full border border-border bg-subtle text-[11.5px] leading-none font-semibold text-ink-secondary"
      >
        {initials(display.fullName)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-[1.3] font-medium">
          {display.fullName}
        </span>
        {display.phone !== null && (
          <span
            dir="ltr"
            className="block font-mono text-xs leading-[1.4] text-ink-muted tabular-nums"
          >
            {formatPhone(display.phone, country)}
          </span>
        )}
      </span>
      {display.patientNumber !== null && (
        <span className={cn(badge, 'border-primary-tint-border bg-primary-tint text-primary')}>
          {t('contacts.picker.patientBadge', { number: display.patientNumber })}
        </span>
      )}
      {display.archived && (
        <span className={cn(badge, 'border-border bg-subtle text-ink-secondary')}>
          {t('contacts.picker.archivedBadge')}
        </span>
      )}
    </li>
  );
}

/** "Add new contact": name*, phone* and relationship. Not a `<form>` of its own — it usually
 * sits inside the patient form — so Enter confirms here and never submits that form. */
function NewContactForm({
  draft,
  country,
  disabled,
  onChange,
  onCancel,
  onConfirm,
}: {
  draft: Draft;
  country: string;
  disabled: boolean;
  onChange: (draft: Draft) => void;
  onCancel: () => void;
  onConfirm: (selection: ContactSelection) => void;
}) {
  const { t } = useTranslation(['patients', 'common']);
  const titleId = useId();
  const errors = draft.checked ? draftErrors(draft, country) : {};
  const message = (key: NewContactError | undefined) =>
    key === undefined ? undefined : t(`contacts.picker.errors.${key}`);

  const confirm = () => {
    const found = draftErrors(draft, country);
    if (found.fullName || found.phone) {
      onChange({ ...draft, checked: true });
      return;
    }
    const phone = normalizePhone(draft.phone, country as PhoneCountry)?.e164 ?? draft.phone.trim();
    const fullName = draft.fullName.trim();
    onConfirm({
      target: { newContact: { fullName, phone, email: null } },
      display: { fullName, phone, patientNumber: null, archived: false },
      relationship: draft.relationship,
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- no standard replacement
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      confirm();
    }
  };

  const required = (
    <span aria-hidden className="ms-0.5 text-danger">
      {'*'}
    </span>
  );

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3 rounded-lg border border-border bg-faint p-3"
    >
      <div id={titleId} className="text-[12.5px] leading-none font-semibold">
        {t('contacts.picker.newTitle')}
      </div>
      <Field
        label={
          <>
            {t('contacts.picker.name')}
            {required}
          </>
        }
        error={message(errors.fullName)}
      >
        {(props) => (
          <TextInput
            {...props}
            aria-required
            disabled={disabled}
            value={draft.fullName}
            onChange={(event) => {
              onChange({ ...draft, fullName: event.target.value });
            }}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field
          label={
            <>
              {t('contacts.picker.phone')}
              {required}
            </>
          }
          error={message(errors.phone)}
        >
          {(props) => (
            <TextInput
              {...props}
              type="tel"
              dir="ltr"
              aria-required
              disabled={disabled}
              value={draft.phone}
              onChange={(event) => {
                onChange({ ...draft, phone: event.target.value });
              }}
              className="font-mono"
            />
          )}
        </Field>
        <Field label={t('contacts.relationship')}>
          {(props) => (
            <RelationshipSelect
              {...props}
              disabled={disabled}
              value={draft.relationship}
              onChange={(relationship) => {
                onChange({ ...draft, relationship });
              }}
            />
          )}
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" disabled={disabled} onClick={onCancel}>
          {t('common:cancel')}
        </Button>
        <Button size="sm" variant="primary" disabled={disabled} onClick={confirm}>
          {t('contacts.picker.add')}
        </Button>
      </div>
    </div>
  );
}
