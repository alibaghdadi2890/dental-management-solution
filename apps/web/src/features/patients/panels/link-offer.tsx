import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { PhoneOffer } from './use-link-offer';

/**
 * What the typed phone offers (`useLinkOffer`, families A): "{name} uses this phone." — or, the
 * phone being on a minor's record, "This phone is on {minor}'s record. Their guardian (billing
 * contact) is {name}." — with Not now, This is {name} (create, an adult, a contact who is no
 * patient) and Add as contact. `blocked` holds back Add while another contact is being added
 * (adding would stage over it), and says so.
 */
export function LinkOffer({
  offer,
  blocked = false,
  onAdd,
  onSame,
  onDismiss,
}: {
  offer: PhoneOffer;
  blocked?: boolean;
  onAdd: () => void;
  onSame: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation('patients');
  const name = offer.selection.display.fullName;
  const message = offer.via
    ? t(
        offer.via.role === 'guardian'
          ? 'contacts.linkOffer.viaGuardian'
          : 'contacts.linkOffer.viaBilling',
        {
          minor: offer.via.name,
          name,
        },
      )
    : t('contacts.linkOffer.uses', { name });
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary-tint-border bg-primary-tint px-3 py-2.5 text-[12.5px] leading-[1.45] text-ink"
    >
      <p className="m-0 min-w-0 flex-1 basis-56">
        {message}
        {blocked && (
          <span className="mt-0.5 block text-xs leading-snug text-ink-muted">
            {t('contacts.linkOffer.finishFirst')}
          </span>
        )}
      </p>
      <div className="flex flex-none flex-wrap gap-2">
        <Button size="sm" onClick={onDismiss}>
          {t('contacts.linkOffer.notNow')}
        </Button>
        {offer.identityContactId !== null && (
          <Button size="sm" onClick={onSame}>
            {t('contacts.linkOffer.same', { name })}
          </Button>
        )}
        <Button size="sm" variant="primary" disabled={blocked} onClick={onAdd}>
          {t('contacts.linkOffer.addContact')}
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
