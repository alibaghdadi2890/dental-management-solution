import { DropdownMenu } from 'radix-ui';
import { type ReactNode, useRef } from 'react';
import { cn } from '@/lib/utils';

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

/**
 * POC menu: white card, 9px radius, 5px padding, menu shadow. Closing it returns focus to its
 * trigger without scrolling it into view — unless something outside the menu has the focus, or
 * `onCloseAutoFocus` prevents it.
 */
export function MenuContent({
  children,
  className,
  align = 'end',
  onCloseAutoFocus,
}: {
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end';
  onCloseAutoFocus?: (event: Event) => void;
}) {
  // The trigger's id, read while the menu is open: Radix labels the content with it.
  const labelledBy = useRef<string | null>(null);
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        ref={(node) => {
          if (node) labelledBy.current = node.getAttribute('aria-labelledby');
        }}
        align={align}
        sideOffset={4}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (event.defaultPrevented) return;
          // Radix would `focus()` the trigger, scrolling it into view: a table under a panel an
          // item just opened slid sideways. Leave focus where an item put it, else return it to
          // the trigger without scrolling.
          event.preventDefault();
          const active = document.activeElement;
          if (active instanceof HTMLElement && active !== document.body) return;
          const triggerId = labelledBy.current;
          if (triggerId) document.getElementById(triggerId)?.focus({ preventScroll: true });
        }}
        className={cn(
          'z-30 w-[196px] animate-fadein rounded-[9px] border border-border bg-surface p-[5px] shadow-[0_10px_28px_rgba(27,26,31,.14)]',
          className,
        )}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

const ITEM =
  'flex h-[34px] w-full cursor-pointer items-center rounded-md px-2.5 text-[13px] leading-none font-medium outline-none data-[disabled]:cursor-default data-[disabled]:opacity-45 data-[highlighted]:bg-background';

export function MenuSeparator() {
  return <DropdownMenu.Separator className="mx-1 my-[5px] h-px bg-inner-divider" />;
}

/** A single choice among `MenuRadioItem`s (a select as a menu): `value` is the checked item. */
export function MenuRadioGroup({
  value,
  onValueChange,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.RadioGroup value={value} onValueChange={onValueChange}>
      {children}
    </DropdownMenu.RadioGroup>
  );
}

/** A `menuitemradio` with the POC check mark at the inline end while it is the checked one. */
export function MenuRadioItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <DropdownMenu.RadioItem value={value} className={cn(ITEM, 'gap-2 text-ink')}>
      <span className="flex-1">{children}</span>
      <DropdownMenu.ItemIndicator className="text-primary">
        <svg
          aria-hidden
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 8.5 6.5 12 13 4.5" />
        </svg>
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  );
}

export function MenuItem({
  children,
  onSelect,
  tone,
  disabled = false,
}: {
  children: ReactNode;
  onSelect: () => void;
  tone?: 'danger';
  disabled?: boolean;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cn(ITEM, tone === 'danger' ? 'text-danger' : 'text-ink')}
    >
      {children}
    </DropdownMenu.Item>
  );
}
