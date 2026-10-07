import type { ServiceItem } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { servicesQuery } from '../../catalog/catalog-api';
import { useChartSettings } from '../../chart/use-chart-settings';
import { useChartingActions } from '../charting-actions';
import { useToothSelection } from '../tooth-selection';

/** How many frequent services are offered as chips; the rest are one click further, in the drawer. */
const MAX_CHIPS = 6;

/** The key that opens the Add service drawer (`useChartKeyboard`), shown on its buttons. */
export function ShortcutHint({ className }: { className?: string }) {
  return (
    <kbd
      aria-hidden
      className={cn(
        'rounded-[4px] border border-current px-1 py-0.5 font-mono text-[10.5px] leading-none opacity-70',
        className,
      )}
    >
      S
    </kbd>
  );
}

/**
 * Adding a service from the top of the tooth panel, a visit's most used action: the **Add
 * service** button (the catalog drawer) and, under it, the clinic's frequently used services of
 * the selected level — per tooth, per jaw or whole mouth — each added in one click on the
 * selection and its pending surfaces, with the same Undo toast as the drawer's.
 */
export function QuickAdd({ onOpen }: { onOpen: () => void }) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const selection = useToothSelection();
  const actions = useChartingActions();
  const { mode } = useChartSettings();
  const services = useQuery(servicesQuery());
  const { tooth, area } = selection;
  const unit = tooth !== null ? 'per_tooth' : area === 'mouth' ? 'per_mouth' : 'per_jaw';
  const frequent = (services.data ?? [])
    .filter((item) => item.active && item.frequent && item.chargeUnit === unit)
    .slice(0, MAX_CHIPS);

  const add = (item: ServiceItem) => {
    actions.addService(item, {
      tooth,
      surfaces: mode === 'surface' && tooth !== null ? selection.surfaces : [],
      jaw: area === 'upper' || area === 'lower' ? area : undefined,
    });
    // The pending scope was used (spec invariant 9).
    if (tooth !== null) selection.select(tooth);
  };

  return (
    <div data-quick-add className="border-b border-inner-divider px-4 py-3">
      <Button variant="primary" className="w-full justify-center" onClick={onOpen}>
        {t('quickAdd.add')}
        <ShortcutHint />
      </Button>
      {frequent.length > 0 && (
        <div
          role="group"
          aria-label={t('quickAdd.frequent')}
          className="mt-2.5 flex flex-wrap gap-1.5"
        >
          {frequent.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={t('quickAdd.addNamed', { name: item.name })}
              title={formatMoney(item.price, locale)}
              onClick={() => {
                add(item);
              }}
              className="h-[28px] max-w-full cursor-pointer truncate rounded-[14px] border border-primary-tint-border bg-primary-tint px-[11px] text-[12px] leading-none font-medium text-primary hover:border-primary"
            >
              {t('quickAdd.chip', { name: item.name })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
