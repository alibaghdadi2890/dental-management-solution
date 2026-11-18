import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * The Patients list's one review strip (families B, F6): possible duplicates (amber, README
 * §Patients anatomy 3) and possible families (indigo), side by side, each shown while its count is
 * above zero. A button needs `patient:write` (`undefined` hides it: the strip only informs).
 */
export function ReviewStrip({
  duplicates,
  families,
  onReviewDuplicates,
  onReviewFamilies,
}: {
  /** Records across every duplicate group. */
  duplicates: number;
  /** Possible families. */
  families: number;
  onReviewDuplicates: (() => void) | undefined;
  onReviewFamilies: (() => void) | undefined;
}) {
  const { t } = useTranslation('patients');
  if (duplicates === 0 && families === 0) return null;
  return (
    <div
      role="status"
      className="mb-3.5 flex flex-wrap overflow-hidden rounded-[9px] border border-border"
    >
      {duplicates > 0 && (
        <Half
          tone="warning"
          title={t('duplicates.title', { count: duplicates })}
          body={t('duplicates.body')}
          action={t('duplicates.review')}
          onAction={onReviewDuplicates}
        />
      )}
      {families > 0 && (
        <Half
          tone="indigo"
          title={t('families.strip', { count: families })}
          body={t('families.stripBody')}
          action={t('families.review')}
          onAction={onReviewFamilies}
        />
      )}
    </div>
  );
}

function Half({
  tone,
  title,
  body,
  action,
  onAction,
}: {
  tone: 'warning' | 'indigo';
  title: string;
  body: ReactNode;
  action: string;
  onAction: (() => void) | undefined;
}) {
  const warning = tone === 'warning';
  return (
    <div
      className={cn(
        'flex min-w-[280px] flex-1 items-center gap-3 border-border px-3.5 py-[11px] [&+&]:border-s',
        warning ? 'bg-warning-bg' : 'bg-primary-tint',
      )}
    >
      <span
        className={cn(
          'flex-none text-[13px] leading-none font-semibold whitespace-nowrap',
          warning ? 'text-warning' : 'text-primary',
        )}
      >
        {title}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 text-[12.5px] leading-[1.4]',
          warning ? 'text-warning-ink' : 'text-ink-secondary',
        )}
      >
        {body}
      </span>
      {onAction && (
        <button
          type="button"
          onClick={onAction}
          className={cn(
            'h-[30px] flex-none cursor-pointer rounded-md border bg-surface px-3 text-[12.5px] leading-none font-medium',
            warning
              ? 'border-warning-control text-warning-ink hover:border-warning'
              : 'border-primary-tint-border text-primary hover:border-primary',
          )}
        >
          {action}
        </button>
      )}
    </div>
  );
}
