import { Tooltip as RadixTooltip } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * The quiet **!** next to a title (CLAUDE.md §13, ADR-0091): whatever needs explaining — how a
 * figure is computed, what it leaves out — sits behind it instead of in a helper sentence. It
 * opens on hover and keyboard focus like every tooltip (`tooltip.tsx`), and on tap or click too,
 * since a touch screen has no hover. `about` names what it explains, for screen readers.
 */
export function InfoMark({
  about,
  children,
  className,
}: {
  about: string;
  children: ReactNode;
  className?: string;
}) {
  const { t, i18n } = useTranslation('common');
  const [open, setOpen] = useState(false);
  return (
    <RadixTooltip.Root open={open} onOpenChange={setOpen} delayDuration={150}>
      <RadixTooltip.Trigger asChild>
        <button
          type="button"
          aria-label={t('infoAbout', { about })}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }}
          className={cn(
            'inline-grid size-4 flex-none cursor-help place-items-center rounded-full border border-border-strong text-[10px] leading-none font-semibold text-ink-muted hover:border-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring print:hidden',
            className,
          )}
        >
          {'!'}
        </button>
      </RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side="top"
          align={i18n.dir() === 'rtl' ? 'end' : 'start'}
          sideOffset={6}
          collisionPadding={12}
          onPointerDownOutside={() => {
            setOpen(false);
          }}
          className="z-40 max-w-[280px] animate-fadein rounded-md bg-ink px-2.5 py-2 text-[12px] leading-snug font-normal text-white shadow-[0_6px_18px_rgba(27,26,31,.18)] motion-reduce:animate-none"
        >
          {children}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
