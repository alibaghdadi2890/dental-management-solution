import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { PhoneOffer } from './use-link-offer';

/**
 * What the typed phone leads to ask (`useLinkOffer`): for an adult "Is this patient {name}? Link
 * to their contact record." — Yes, same person / No; for a minor "This phone belongs to {name}.
 * Add {name} as guardian?" — Add as guardian / Not now. `blocked` holds back accepting while
 * another contact is being added (accepting would stage over it), and says so.
 */
export function LinkOffer({
  offer,
  blocked = false,
  onAccept,
  onDismiss,
}: {
  offer: PhoneOffer;
  blocked?: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation('patients');
  const identity = offer.kind === 'identity';
  const name = identity ? offer.fullName : offer.selection.display.fullName;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary-tint-border bg-primary-tint px-3 py-2.5 text-[12.5px] leading-[1.45] text-ink"
    >
      <p className="m-0 min-w-0 flex-1 basis-56">
        {t(identity ? 'contacts.linkOffer.identity' : 'contacts.linkOffer.guardian', { name })}
        {blocked && (
          <span className="mt-0.5 block text-xs leading-snug text-ink-muted">
            {t('contacts.linkOffer.finishFirst')}
          </span>
        )}
      </p>
      <div className="flex flex-none gap-2">
        <Button size="sm" onClick={onDismiss}>
          {t(identity ? 'contacts.linkOffer.different' : 'contacts.linkOffer.notNow')}
        </Button>
        <Button size="sm" variant="primary" disabled={blocked} onClick={onAccept}>
          {t(identity ? 'contacts.linkOffer.same' : 'contacts.linkOffer.addGuardian')}
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
