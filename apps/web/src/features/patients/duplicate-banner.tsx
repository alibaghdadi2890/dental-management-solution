import { useTranslation } from 'react-i18next';

/**
 * Amber banner over the list when active records share a name and date of birth (README
 * §Patients, anatomy 3). "Review & merge" needs `patient:write`; without it the banner only
 * informs.
 */
export function DuplicateBanner({
  count,
  onReview,
}: {
  /** Records across every duplicate group. */
  count: number;
  onReview: (() => void) | undefined;
}) {
  const { t } = useTranslation('patients');
  return (
    <div
      role="status"
      className="mb-3.5 flex items-center gap-3 rounded-[9px] border border-warning-border bg-warning-bg px-3.5 py-[11px]"
    >
      <span className="flex-none text-[13px] leading-none font-semibold whitespace-nowrap text-warning">
        {t('duplicates.title', { count })}
      </span>
      <span className="min-w-0 flex-1 text-[12.5px] leading-[1.4] text-[#5c4a22]">
        {t('duplicates.body')}
      </span>
      {onReview && (
        <button
          type="button"
          onClick={onReview}
          className="h-[30px] flex-none cursor-pointer rounded-md border border-[#d9c089] bg-surface px-3 text-[12.5px] leading-none font-medium text-[#5c4a22] hover:border-warning"
        >
          {t('duplicates.review')}
        </button>
      )}
    </div>
  );
}
