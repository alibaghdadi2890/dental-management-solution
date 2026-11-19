import { useId } from 'react';
import { cn } from '@/lib/utils';
import { type Units, useInventoryWords } from './inventory-words';
import { type QuantityValue, unitsOf } from './quantities';

/**
 * A quantity typed in packs or in units (D11): a whole number and, for an item with a pack, a
 * switch between the two; both are shown underneath once there is a number.
 */
export function QuantityInput({
  id,
  item,
  value,
  onChange,
  invalid = false,
  label,
  className,
}: {
  id?: string;
  item: Units | undefined;
  value: QuantityValue;
  onChange: (value: QuantityValue) => void;
  invalid?: boolean;
  /** The accessible name when there is no visible label. */
  label?: string;
  className?: string;
}) {
  const { t, quantity, packWord, unitWord } = useInventoryWords();
  const ownId = useId();
  const units = unitsOf(value, item);
  const hasPack = Boolean(item?.packSize && item.packName);
  return (
    <div className={cn('min-w-0', className)}>
      <div
        className={cn(
          'flex h-9 items-center rounded-lg border bg-surface',
          invalid ? 'border-danger' : 'border-border-control',
        )}
      >
        <input
          id={id ?? ownId}
          inputMode="numeric"
          aria-label={label}
          aria-invalid={invalid}
          value={value.text}
          onChange={(event) => {
            onChange({ ...value, text: event.target.value.replace(/[^\d]/g, '') });
          }}
          className="h-full w-0 min-w-0 flex-1 rounded-lg border-none bg-transparent px-[11px] text-[13px] tabular-nums outline-none"
        />
        {hasPack && item ? (
          <div role="group" aria-label={t('quantity.mode')} className="flex flex-none gap-0.5 pe-1">
            {(['pack', 'unit'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={value.mode === mode}
                onClick={() => {
                  onChange({ ...value, mode });
                }}
                className={cn(
                  'h-7 cursor-pointer rounded-md px-2 text-[12px] leading-none',
                  value.mode === mode
                    ? 'bg-ink text-white'
                    : 'bg-transparent text-ink-secondary hover:bg-subtle',
                )}
              >
                {mode === 'pack' ? packWord(item.packName ?? '', 2) : unitWord(item.unit, 2)}
              </button>
            ))}
          </div>
        ) : (
          item && (
            <span className="flex-none pe-[11px] text-[12px] text-ink-muted">
              {unitWord(item.unit, 2)}
            </span>
          )
        )}
      </div>
      {units !== null &&
        item &&
        hasPack &&
        (value.mode === 'pack' || units >= (item.packSize ?? 0)) && (
          <span className="mt-1 block text-[11.5px] text-ink-muted tabular-nums">
            {value.mode === 'pack'
              ? t('quantity.equals', { what: `${String(units)} ${unitWord(item.unit, units)}` })
              : t('quantity.equals', { what: quantity(units, item).split(' · ')[1] ?? '' })}
          </span>
        )}
    </div>
  );
}
