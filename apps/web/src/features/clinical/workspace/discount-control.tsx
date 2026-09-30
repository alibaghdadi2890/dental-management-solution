import { DISCOUNT_MODES, type DiscountMode } from '@dcm/contracts';
import { type KeyboardEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { sanitizeAmountInput } from '@/lib/amount';
import { currencySymbol } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SaveGroup } from '../use-save-group';
import type { DiscountDraft } from './visit-discount';

/** A radio group's arrow keys: the next or the previous mode, wrapping. */
const ARROW_STEPS: Readonly<Partial<Record<string, number>>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * The visit discount (spec §Financial bar → Visit discount): a 56px right-aligned Mono input
 * beside a `% / $` segmented control (the `$` is the visit currency's symbol), a radio group:
 * the checked mode takes the tab stop and the arrow keys switch it. It edits the
 * `discount` save group it is given (`useVisitDiscount`), so the financial bar and the summary
 * dialog show one value. Typing is cleaned as it goes — anything but digits and one decimal
 * separator is dropped, so a negative can't be typed — and the value is kept as typed above its
 * cap; the cap is the money's business (`visitMoney`). Read-only without `visit:write`.
 */
export function DiscountControl({
  discount,
  currency,
  readOnly,
}: {
  discount: SaveGroup<DiscountDraft>;
  currency: string;
  readOnly: boolean;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const { value, setValue } = discount;
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const symbol = (mode: DiscountMode) =>
    mode === 'percent' ? '%' : currencySymbol(currency, locale);
  const choose = (mode: DiscountMode) => {
    if (mode !== value.mode) setValue({ ...value, mode });
  };
  /** Arrow keys move the choice and the focus with it. */
  const onArrow = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = ARROW_STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = (index + step + DISCOUNT_MODES.length) % DISCOUNT_MODES.length;
    const mode = DISCOUNT_MODES[next];
    if (mode === undefined) return;
    choose(mode);
    radios.current[next]?.focus();
  };

  return (
    <div className="flex items-center gap-[5px]">
      <input
        aria-label={t('money.discountValue')}
        dir="ltr"
        inputMode="decimal"
        maxLength={13}
        readOnly={readOnly}
        value={value.value}
        onChange={(event) => {
          setValue({ ...value, value: sanitizeAmountInput(event.target.value, locale) });
        }}
        className="h-7 w-14 rounded-md border border-border-control bg-surface px-2 text-end font-mono text-[13px] leading-none font-medium tabular-nums focus:border-primary read-only:border-transparent read-only:bg-transparent"
      />
      <div
        role="radiogroup"
        aria-label={t('money.mode')}
        className="flex gap-0.5 rounded-md border border-border bg-subtle p-0.5"
      >
        {DISCOUNT_MODES.map((mode, index) => {
          const active = value.mode === mode;
          return (
            <button
              key={mode}
              ref={(element) => {
                radios.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-label={t(`money.${mode}`)}
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              disabled={readOnly}
              onClick={() => {
                choose(mode);
              }}
              onKeyDown={onArrow(index)}
              className={cn(
                'h-6 cursor-pointer rounded-[4px] border-0 px-[9px] font-mono text-[12.5px] leading-none font-semibold disabled:cursor-default',
                active
                  ? 'bg-surface text-primary shadow-[0_1px_2px_rgba(27,26,31,.1)]'
                  : 'bg-transparent text-ink-muted',
              )}
            >
              {symbol(mode)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
