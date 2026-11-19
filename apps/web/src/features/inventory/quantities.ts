import { type QuantityMode, toUnits } from '@dcm/contracts';
import type { Units } from './inventory-words';

/** What the field holds: the typed number and whether it counts packs or units. */
export interface QuantityValue {
  text: string;
  mode: QuantityMode;
}

export const emptyQuantity = (item: Units | undefined): QuantityValue => ({
  text: '',
  mode: item?.packSize ? 'pack' : 'unit',
});

/** The units a value stands for; null while it is not a whole number above zero. */
export function unitsOf(value: QuantityValue, item: Units | undefined): number | null {
  if (!/^\d{1,7}$/.test(value.text.trim())) return null;
  const typed = Number(value.text.trim());
  if (typed <= 0) return null;
  return toUnits(typed, value.mode, item?.packSize ?? null);
}
