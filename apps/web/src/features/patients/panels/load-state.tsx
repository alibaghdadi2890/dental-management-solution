import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SHIMMER } from '@/components/ui/list';
import { cn } from '@/lib/utils';

/**
 * The contacts blocks' state while their list is not there yet: a shimmer (announced as "Loading
 * contacts"), or — when it failed — `failed` with Try again.
 */
export function LoadState({
  error,
  failed,
  onRetry,
}: {
  error: boolean;
  failed: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation(['patients', 'common']);
  if (!error) {
    return (
      <span
        role="status"
        aria-label={t('contacts.current.loading')}
        className={cn('block h-9 w-full', SHIMMER)}
      />
    );
  }
  return (
    <div role="alert" className="flex items-center gap-2">
      <span className="text-[12.5px] leading-snug text-ink-secondary">{failed}</span>
      <Button variant="ghost" size="sm" className="px-0" onClick={onRetry}>
        {t('common:tryAgain')}
      </Button>
    </div>
  );
}
