import { useId } from 'react';
import { cn } from '@/lib/utils';

/** A two-or-more-way choice as a segmented control (the Adjust balance direction's look). */
export function Segmented<TValue extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: TValue; label: string }[];
  value: TValue;
  onChange: (value: TValue) => void;
}) {
  const labelId = useId();
  return (
    <div>
      <div id={labelId} className="mb-1.5 text-[12.5px] leading-none font-medium">
        {label}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-lg border border-border-control bg-sunken p-0.5"
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => {
              onChange(option.value);
            }}
            className={cn(
              'h-[32px] cursor-pointer rounded-[6px] border-0 px-2 text-[12.5px] font-medium',
              value === option.value
                ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(27,26,31,.14)]'
                : 'bg-transparent text-ink-secondary hover:text-ink',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
