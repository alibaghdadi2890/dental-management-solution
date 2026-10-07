import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

/** POC buttons: 36px (default), 34px toolbar, 28–30px compact, 40px login. 12.5px/500 labels. */
const VARIANTS = {
  primary:
    'border-primary bg-primary text-primary-foreground hover:border-primary-hover hover:bg-primary-hover',
  secondary: 'border-border-control bg-surface text-ink hover:border-ink',
  outline: 'border-border-control bg-surface text-ink hover:border-primary hover:text-primary',
  danger: 'border-border-control bg-surface text-danger hover:border-danger',
  dangerSolid: 'border-danger bg-danger text-white hover:border-danger-hover hover:bg-danger-hover',
  dark: 'border-ink bg-ink text-white hover:bg-black',
  ghost: 'border-transparent bg-transparent text-primary hover:underline',
} as const;

const SIZES = {
  md: 'h-9 px-3.5',
  toolbar: 'h-[34px] px-[13px]',
  sm: 'h-[30px] px-3',
  lg: 'h-10 w-full justify-center text-[13px]',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  busy?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  className,
  disabled,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      className={cn(
        'inline-flex flex-none cursor-pointer items-center gap-2 rounded-lg border text-[12.5px] leading-none font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {busy && (
        <Spinner tone={variant === 'primary' || variant === 'dangerSolid' ? 'light' : 'dark'} />
      )}
      {children}
    </button>
  );
}

/** 30px square icon button used for ⋯ menus, close and sign-out. */
export function IconButton({
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  'aria-label': string;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      type={type}
      className={cn(
        'grid size-[30px] flex-none cursor-pointer place-items-center rounded-md border border-transparent bg-transparent text-ink-muted hover:border-border hover:bg-faint hover:text-ink',
        className,
      )}
      {...props}
    />
  );
}
