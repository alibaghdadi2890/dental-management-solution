import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

/** POC menu: white card, 9px radius, 5px padding, menu shadow. Closing it returns focus to its
 * trigger unless `onCloseAutoFocus` prevents that (an item that moved focus elsewhere). */
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
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={4}
        onCloseAutoFocus={onCloseAutoFocus}
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
      className={cn(
        'flex h-[34px] w-full cursor-pointer items-center rounded-md px-2.5 text-[13px] leading-none font-medium outline-none data-[disabled]:cursor-default data-[disabled]:opacity-45 data-[highlighted]:bg-background',
        tone === 'danger' ? 'text-danger' : 'text-ink',
      )}
    >
      {children}
    </DropdownMenu.Item>
  );
}
