import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SHIMMER } from '@/components/ui/list';
import { RightPanel } from '@/components/ui/right-panel';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * The right panel while its patient(s) load, or when they can't be shown: a 404 (an unknown id, a
 * patient of another clinic, a stale link) reads "Patient not found"; any other failure offers
 * Try again. Either way the header's close button closes it.
 */
export function PanelFallback({
  eyebrow,
  error,
  onRetry,
  onClose,
}: {
  eyebrow: string;
  /** `null` while loading. */
  error: Error | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(['patients', 'common']);

  if (error === null) {
    return (
      <RightPanel eyebrow={eyebrow} title={t('panel.loading')} dirty={false} onClose={onClose}>
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className={cn('h-3.5 w-48', SHIMMER)} />
          <span className={cn('h-2.5 w-32', SHIMMER)} />
          <span className={cn('h-2.5 w-56', SHIMMER)} />
          <span className={cn('h-2.5 w-40', SHIMMER)} />
        </div>
      </RightPanel>
    );
  }

  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <RightPanel
      eyebrow={eyebrow}
      title={notFound ? t('panel.notFoundTitle') : t('panel.failedTitle')}
      dirty={false}
      onClose={onClose}
      footer={notFound ? undefined : <Button onClick={onRetry}>{t('common:tryAgain')}</Button>}
    >
      <p role="alert" className="text-[13px] leading-normal text-ink-secondary">
        {notFound ? t('panel.notFoundBody') : t('panel.failedBody')}
      </p>
    </RightPanel>
  );
}
