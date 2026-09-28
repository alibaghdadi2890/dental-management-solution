import type { ContactView } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/** "This phone belongs to contact {name}. Link this patient to {name}?" — Link / Not now. */
export function LinkOffer({
  contact,
  onLink,
  onDismiss,
}: {
  contact: ContactView;
  onLink: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation('patients');
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary-tint-border bg-primary-tint px-3 py-2.5 text-[12.5px] leading-[1.45] text-ink"
    >
      <p className="m-0 min-w-0 flex-1 basis-56">
        {t('contacts.linkOffer.body', { name: contact.fullName })}
      </p>
      <div className="flex flex-none gap-2">
        <Button size="sm" onClick={onDismiss}>
          {t('contacts.linkOffer.notNow')}
        </Button>
        <Button size="sm" variant="primary" onClick={onLink}>
          {t('contacts.linkOffer.link')}
        </Button>
      </div>
    </div>
  );
}

/** "Will link to {name}", dismissible; the server's refusal (e.g. already a patient) beneath. */
export function LinkChip({
  name,
  error,
  onRemove,
}: {
  name: string;
  error: string | undefined;
  onRemove: () => void;
}) {
  const { t } = useTranslation('patients');
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-primary-tint-border bg-primary-tint ps-2.5 pe-1 text-xs leading-none font-medium text-primary">
        {t('contacts.linkOffer.chip', { name })}
        <button
          type="button"
          aria-label={t('contacts.linkOffer.remove', { name })}
          onClick={onRemove}
          className="grid size-5 cursor-pointer place-items-center rounded border-0 bg-transparent text-primary hover:bg-surface"
        >
          <svg aria-hidden width="10" height="10" viewBox="0 0 10 10">
            <path d="m2 2 6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </span>
      {error && (
        <span role="alert" className="text-xs leading-tight font-medium text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
