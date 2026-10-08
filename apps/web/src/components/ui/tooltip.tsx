import { Tooltip as RadixTooltip } from 'radix-ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** One per group of tooltips, so moving between triggers shows the next one without a delay. */
export const TooltipProvider = RadixTooltip.Provider;

/**
 * A dark label beside its trigger, on hover and keyboard focus. `side="inline-end"` follows the
 * reading direction (right in LTR, left in RTL). With no `label` it renders the trigger alone.
 * The trigger must forward a ref (a DOM element or a Radix trigger).
 */
export function Tooltip({
  label,
  side = 'inline-end',
  children,
}: {
  label: ReactNode;
  side?: 'inline-end' | 'top' | 'bottom';
  children: ReactNode;
}) {
  const { i18n } = useTranslation();
  if (!label) return children;
  const physical = side === 'inline-end' ? (i18n.dir() === 'rtl' ? 'left' : 'right') : side;
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={physical}
          sideOffset={8}
          className="z-40 animate-fadein rounded-md bg-ink px-2 py-[5px] text-[12px] leading-snug font-medium text-white shadow-[0_6px_18px_rgba(27,26,31,.18)]"
        >
          {label}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
