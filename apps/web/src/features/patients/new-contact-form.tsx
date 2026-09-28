import { type KeyboardEvent, useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import {
  type ContactSelection,
  draftErrors,
  type NewContactDraft,
  type NewContactError,
  selectionOf,
} from './new-contact-draft';
import { RelationshipSelect } from './relationship-select';

/**
 * "Add new contact" (the contact picker's create half): name*, phone* (checked against the
 * tenant's `country`) and relationship. The name has focus when it opens. Not a `<form>` of its
 * own — it usually sits inside the patient form — so Enter confirms here and never submits that
 * form, and Escape cancels here (prevented, so the panel around it stays open).
 */
export function NewContactForm({
  draft,
  country,
  disabled,
  onChange,
  onCancel,
  onConfirm,
}: {
  draft: NewContactDraft;
  country: string;
  disabled: boolean;
  onChange: (draft: NewContactDraft) => void;
  onCancel: () => void;
  onConfirm: (selection: ContactSelection) => void;
}) {
  const { t } = useTranslation(['patients', 'common']);
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const errors = draft.checked ? draftErrors(draft, country) : {};
  const message = (key: NewContactError | undefined) =>
    key === undefined ? undefined : t(`contacts.picker.errors.${key}`);

  const confirm = () => {
    const found = draftErrors(draft, country);
    if (found.fullName || found.phone) {
      onChange({ ...draft, checked: true });
      return;
    }
    onConfirm(selectionOf(draft, country));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // An input method (Arabic, CJK…) uses Enter and Escape for its own candidates.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- no standard replacement
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
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
            ref={nameRef}
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
