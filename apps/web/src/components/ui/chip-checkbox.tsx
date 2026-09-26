import { cn } from '@/lib/utils';

/**
 * Multi-select as checkbox chips (spec: roles and branches in the user panel). Selected chips use
 * the POC's active chip style (`#eceef8` / `#c3c7ea`).
 */
export function ChipCheckboxGroup({
  label,
  options,
  selected,
  onToggle,
  error,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  error?: string | undefined;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[12.5px] leading-none font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = selected.includes(option.value);
          return (
            <label
              key={option.value}
              className={cn(
                'relative inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-[7px] border px-2.5 text-[12.5px] leading-none font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary',
                on
                  ? 'border-primary-tint-border bg-primary-tint text-primary'
                  : 'border-border-control bg-surface text-ink-secondary hover:border-ink-muted',
              )}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => {
                  onToggle(option.value);
                }}
                className="absolute inset-0 z-10 m-0 cursor-pointer appearance-none opacity-0"
              />
              <span
                aria-hidden
                className={cn(
                  'grid size-3.5 place-items-center rounded-[4px] border',
                  on ? 'border-primary bg-primary text-white' : 'border-border-strong bg-surface',
                )}
              >
                {on && (
                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor">
                    <path d="m2 5.2 2 2L8 3" strokeWidth="1.8" />
                  </svg>
                )}
              </span>
              {option.label}
            </label>
          );
        })}
      </div>
      {error && (
        <span role="alert" className="mt-[5px] block text-xs leading-tight font-medium text-danger">
          {error}
        </span>
      )}
    </fieldset>
  );
}
