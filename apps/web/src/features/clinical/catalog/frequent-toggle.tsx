import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { STAR_PATH } from './catalog-layout';

function Star({ on }: { on: boolean }) {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16">
      <path
        d={STAR_PATH}
        strokeWidth="1.3"
        strokeLinejoin="round"
        className={on ? 'fill-primary stroke-primary' : 'fill-none stroke-ink-muted'}
      />
    </svg>
  );
}

/**
 * The Frequent column (design gap, feature 2): a 16px outline star, filled indigo when the row is
 * listed under "Frequently used" in the visit drawer. Static for read-only users.
 */
export function FrequentToggle({
  on,
  readOnly,
  onToggle,
}: {
  on: boolean;
  readOnly: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('catalog');
  if (readOnly) {
    return (
      <span
        role="img"
        aria-label={on ? t('frequent.on') : t('frequent.off')}
        className={cn('grid size-[30px] place-items-center', !on && 'opacity-50')}
      >
        <Star on={on} />
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={t('frequent.on')}
      onClick={onToggle}
      className="grid size-[30px] cursor-pointer place-items-center rounded-md border border-transparent bg-transparent hover:border-border hover:bg-faint"
    >
      <Star on={on} />
    </button>
  );
}
