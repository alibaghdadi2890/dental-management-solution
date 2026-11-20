import { useTranslation } from 'react-i18next';

/** A card's first rows only; the rest behind _Show all n_ (the board's long cards). */
export function BoardMore({ total, onShowAll }: { total: number; onShowAll: () => void }) {
  const { t } = useTranslation('common');
  return (
    <button
      type="button"
      onClick={onShowAll}
      className="block w-full cursor-pointer border-t border-row-divider py-2 text-center text-[12px] font-semibold text-(--hue-ink) hover:bg-faint"
    >
      {t('board.showAll', { count: total })}
    </button>
  );
}
