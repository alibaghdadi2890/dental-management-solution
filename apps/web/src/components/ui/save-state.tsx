import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * Where an explicitly saved form stands (patients design Q16): `clean` shows nothing, `dirty`
 * "Unsaved changes", `saving` "Saving…" with the POC's 11px spinner, `saved` "✓ Saved just now",
 * `failed` "Failed to save — retry", which retries when clicked.
 */
export type SaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'failed';

const TEXT = 'inline-flex items-center gap-1.5 text-[11.5px] leading-none font-medium';

/** The save-state indicator (workspace spec §Loading, Saving & Error States): one inline, polite
 * live region, so each change of state is announced. */
export function SaveState({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  const { t } = useTranslation('common');
  return (
    <span role="status" className="inline-flex min-h-[18px] items-center">
      {status === 'dirty' && (
        <span className={cn(TEXT, 'text-ink-muted')}>{t('saveState.unsaved')}</span>
      )}
      {status === 'saving' && (
        <span className={cn(TEXT, 'text-primary')}>
          <span
            aria-hidden
            className="size-[11px] flex-none animate-[spin_700ms_linear_infinite] rounded-full border-2 border-primary-tint-border border-t-primary"
          />
          {t('saveState.saving')}
        </span>
      )}
      {status === 'saved' && (
        <span className={cn(TEXT, 'text-success')}>{t('saveState.saved')}</span>
      )}
      {status === 'failed' && (
        <button
          type="button"
          onClick={onRetry}
          className={cn(TEXT, 'cursor-pointer text-danger hover:underline')}
        >
          {t('saveState.failed')}
        </button>
      )}
    </span>
  );
}
