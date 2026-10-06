import type { PlanGroup, PlanGroupInput } from '@dcm/contracts';
import { Dialog } from 'radix-ui';
import { type SyntheticEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/field';
import { apiErrorMessage } from '@/lib/api-error-message';

const TITLE_MAX = 120;
const NOTE_MAX = 500;

/**
 * Creates or renames a named plan (levels spec P7): a title and an optional note. `group` is the
 * one being renamed; without it the dialog creates. Stays open, with the reason, when the save
 * fails.
 */
export function PlanGroupDialog({
  group,
  onSave,
  onClose,
}: {
  group?: PlanGroup | undefined;
  onSave: (input: PlanGroupInput) => Promise<void>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('clinical');
  const titleId = useId();
  const noteId = useId();
  const [title, setTitle] = useState(group?.title ?? '');
  const [note, setNote] = useState(group?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = title.trim().length === 0;

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ title: title.trim(), note: note.trim() || null });
      onClose();
    } catch (failure) {
      setError(apiErrorMessage(failure, i18n));
      setBusy(false);
    }
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fadein bg-[rgba(27,26,31,.28)]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed start-1/2 top-1/2 z-50 w-[calc(100%-48px)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 animate-popin rounded-2xl border border-border bg-surface shadow-[0_18px_48px_rgba(27,26,31,.18)] rtl:translate-x-1/2"
        >
          <form
            onSubmit={(event) => {
              void submit(event);
            }}
            className="px-5 pt-5 pb-[18px]"
          >
            <Dialog.Title className="m-0 mb-4 text-base leading-tight font-semibold tracking-[-0.01em]">
              {t(group ? 'planGroup.editTitle' : 'planGroup.newTitle')}
            </Dialog.Title>
            <label
              htmlFor={titleId}
              className="mb-1.5 block text-[12.5px] leading-none font-medium"
            >
              {t('planGroup.title')}
            </label>
            <TextInput
              id={titleId}
              value={title}
              maxLength={TITLE_MAX}
              placeholder={t('planGroup.titlePlaceholder')}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
            <label
              htmlFor={noteId}
              className="mt-3.5 mb-1.5 block text-[12.5px] leading-none font-medium"
            >
              {t('planGroup.note')}
            </label>
            <textarea
              id={noteId}
              value={note}
              rows={3}
              maxLength={NOTE_MAX}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              className="w-full resize-y rounded-lg border border-border-control bg-surface px-2.5 py-[9px] text-[13px] leading-[1.45]"
            />
            {error !== null && (
              <p role="alert" className="mt-3 text-[12.5px] leading-snug font-medium text-danger">
                {error}
              </p>
            )}
            <div className="mt-[18px] flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={onClose}>
                {t('planGroup.cancel')}
              </Button>
              <Button variant="primary" type="submit" disabled={blocked} busy={busy}>
                {t(group ? 'planGroup.save' : 'planGroup.create')}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
