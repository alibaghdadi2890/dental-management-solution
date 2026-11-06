import { PAYMENT_METHODS, type PaymentMethod } from '@dcm/contracts';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** The payment methods as pills (the Record payout look): the clinic's methods for payments. */
export function MethodPicker({
  label,
  value,
  onChange,
  compact = false,
}: {
  label: string;
  value: PaymentMethod | null;
  onChange: (method: PaymentMethod) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation('billing');
  const labelId = useId();
  return (
    <div>
      <div
        id={labelId}
        className={cn('mb-1.5 text-[12.5px] leading-none font-medium', compact && 'sr-only')}
      >
        {label}
      </div>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
        {PAYMENT_METHODS.map((method) => (
          <button
            key={method}
            type="button"
            role="radio"
            aria-checked={value === method}
            onClick={() => {
              onChange(method);
            }}
            className={cn(
              'cursor-pointer rounded-[15px] border px-3 text-[12px] font-medium',
              compact ? 'h-[26px] px-2.5' : 'h-[30px]',
              value === method
                ? 'border-primary bg-primary-tint text-primary'
                : 'border-border-control bg-surface hover:border-ink',
            )}
          >
            {t(`methods.${method}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
