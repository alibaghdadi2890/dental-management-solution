import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/button';
import { formatMonth, shiftMonth } from './months';

/**
 * ← October 2026 →. With `months` (the dentist's own statements) it steps only through those;
 * otherwise through every month up to `latest`.
 */
export function MonthPicker({
  month,
  latest,
  months,
  onChange,
}: {
  month: string;
  latest: string;
  months?: readonly string[];
  onChange: (month: string) => void;
}) {
  const { t, i18n } = useTranslation('compensation');
  const locale = i18n.resolvedLanguage ?? 'en';
  const sorted = months ? [...months].sort() : undefined;
  const index = sorted?.indexOf(month) ?? -1;
  const previous = sorted ? sorted[index - 1] : shiftMonth(month, -1);
  const next = sorted ? sorted[index + 1] : month < latest ? shiftMonth(month, 1) : undefined;
  return (
    <div className="flex items-center gap-1">
      <IconButton
        aria-label={t('month.previous')}
        disabled={previous === undefined}
        onClick={() => {
          if (previous) onChange(previous);
        }}
        className="disabled:cursor-default disabled:opacity-40 rtl:rotate-180"
      >
        <span aria-hidden>‹</span>
      </IconButton>
      <span aria-live="polite" className="min-w-[132px] text-center text-[13.5px] font-semibold">
        {formatMonth(month, locale)}
      </span>
      <IconButton
        aria-label={t('month.next')}
        disabled={next === undefined}
        onClick={() => {
          if (next) onChange(next);
        }}
        className="disabled:cursor-default disabled:opacity-40 rtl:rotate-180"
      >
        <span aria-hidden>›</span>
      </IconButton>
    </div>
  );
}
