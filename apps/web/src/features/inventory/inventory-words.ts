import {
  INVENTORY_PACK_KEYS,
  INVENTORY_UNIT_KEYS,
  type InventoryCategory,
  splitPacks,
  type StockLabel,
  type StockLabelKind,
} from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { formatCount, formatDayMonth } from '@/lib/format';

/** What a quantity needs to know about its item (D11). */
export interface Units {
  unit: string;
  packName: string | null;
  packSize: number | null;
}

const UNIT_KEYS: readonly string[] = INVENTORY_UNIT_KEYS;
const PACK_KEYS: readonly string[] = INVENTORY_PACK_KEYS;

/**
 * The words of inventory, in one place: a category's name (a predefined one by key), a unit or
 * a pack (a listed word translated with its plural, a clinic's own word as typed), a quantity in
 * units and packs, and a label's words.
 */
export function useInventoryWords() {
  const { t, i18n } = useTranslation('inventory');
  const locale = i18n.resolvedLanguage ?? 'en';
  const translate = t as unknown as (key: string, values?: object) => string;

  const unitWord = (word: string, count: number) =>
    UNIT_KEYS.includes(word) ? translate(`unit.${word}`, { count }) : word;
  const packWord = (word: string, count: number) =>
    PACK_KEYS.includes(word) ? translate(`pack.${word}`, { count }) : word;

  /** `720 pieces · 7 boxes + 20`: the units first, then whole packs and what is left over. */
  const quantity = (units: number, item: Units): string => {
    const text = `${formatCount(units, locale)} ${unitWord(item.unit, Math.abs(units))}`;
    if (item.packName === null || item.packSize === null || Math.abs(units) < item.packSize) {
      return text;
    }
    const split = splitPacks(units, item.packSize);
    const packs = `${formatCount(split.packs, locale)} ${packWord(item.packName, Math.abs(split.packs))}`;
    return split.units === 0
      ? `${text} · ${packs}`
      : `${text} · ${packs} + ${formatCount(Math.abs(split.units), locale)}`;
  };

  /** `Box of 100`. */
  const packText = (item: Units): string | null =>
    item.packName === null || item.packSize === null
      ? null
      : t('item.packOf', { pack: packWord(item.packName, 1), size: item.packSize });

  const categoryName = (category: InventoryCategory | undefined): string =>
    category === undefined
      ? '—'
      : category.key === null
        ? (category.name ?? '')
        : t(`category.${category.key}`);

  const labelText = (label: StockLabel): string =>
    label.date === null
      ? t(`label.${label.kind}`)
      : t(`label.${label.kind}Dated`, { date: formatDayMonth(label.date, locale) });

  return { t, i18n, locale, unitWord, packWord, quantity, packText, categoryName, labelText };
}

/** One look per label, everywhere (B6): the alarms solid, the warnings amber, the rest quiet. */
export const LABEL_STYLES: Readonly<Record<StockLabelKind, string>> = {
  out: 'border-danger bg-danger text-white font-semibold',
  expired: 'border-danger-border bg-danger-bg text-danger font-semibold',
  low: 'border-warning-border bg-warning-bg text-warning font-semibold',
  expiring: 'border-warning-border bg-surface text-warning',
  ordered: 'border-primary-tint-border bg-primary-tint text-primary',
  to_count: 'border-dashed border-border-strong bg-surface text-ink-secondary',
};
