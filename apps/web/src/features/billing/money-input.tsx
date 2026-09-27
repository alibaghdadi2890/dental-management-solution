import type { InputHTMLAttributes } from 'react';
import { currencySymbol } from '@/lib/format';
import { cn } from '@/lib/utils';

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>;

/**
 * A money amount as typed (design "Account" group: 36px, Mono, right-aligned, the tenant currency
 * after it). It shows exactly what the person typed — `12,50` in French — and leaves turning that
 * into a plain decimal (`sanitizeAmount`/`sanitizeAmountInput`) to the form that owns the value.
 */
export function MoneyInput({
  value,
  onChange,
  currency,
  locale,
  className,
  ...props
}: NativeProps & {
  value: string;
  onChange: (text: string) => void;
  /** ISO 4217 code; shown as its narrow symbol. */
  currency: string;
  locale: string;
}) {
  return (
    <div
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-lg border border-border-control bg-surface px-[11px] font-mono text-[13px] leading-none focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-ring has-[[aria-invalid=true]]:border-danger',
        className,
      )}
    >
      <input
        {...props}
        dir="ltr"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-full w-full min-w-0 bg-transparent text-end text-ink tabular-nums outline-none"
      />
      <span aria-hidden className="flex-none text-ink-muted">
        {currencySymbol(currency, locale)}
      </span>
    </div>
  );
}
