import type { ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';

/**
 * An icon button of the viewer's dark top bar: its label is its tooltip and its accessible name,
 * with the shortcut that does the same.
 */
export function ViewerButton({
  ref,
  label,
  shortcut,
  pressed,
  disabled,
  onClick,
  className,
  children,
}: {
  ref?: Ref<HTMLButtonElement>;
  label: string;
  /** The key that does the same, as written on a keyboard (`R`, `+`). */
  shortcut?: string;
  /** For a toggle: whether it is on. */
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid h-8 min-w-8 flex-none cursor-pointer place-items-center rounded-md border px-1.5 text-[12px] leading-none font-medium disabled:cursor-not-allowed disabled:opacity-40',
        pressed
          ? 'border-white/40 bg-white/15 text-white'
          : 'border-transparent bg-transparent text-white/75 hover:bg-white/10 hover:text-white',
        className,
      )}
    >
      {children}
    </button>
  );
}

const PATHS = {
  rotate: 'M12.5 8a4.5 4.5 0 1 1-1.4-3.2M12.5 2.5v3h-3',
  fullscreen: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
  info: 'M8 7.2V11.5M8 4.6v.1M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z',
  download: 'M8 2.5v8m0 0L5 7.5m3 3 3-3M3 13.5h10',
  archive: 'M2.5 3.5h11v3h-11zM3.5 6.5v6.5h9V6.5M6.5 9.2h3',
  restore: 'M3.5 8a4.5 4.5 0 1 0 1.4-3.2M3.5 2.5v3h3',
  close: 'm3.5 3.5 9 9m0-9-9 9',
  plus: 'M8 3.5v9M3.5 8h9',
  minus: 'M3.5 8h9',
  invert: 'M8 2a6 6 0 1 0 0 12ZM8 2a6 6 0 1 1 0 12',
  sliders: 'M2.5 5h6m3 0h2M2.5 11h2m3 0h6M10 3.5v3M6 9.5v3',
  help: 'M6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.3-.8.7-.8 1.3M8 11.6v.1M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z',
  previous: 'M10 3 5 8l5 5',
  next: 'm6 3 5 5-5 5',
} as const;

/** The viewer's 16px line icons. */
export function ViewerIcon({ name, className }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
