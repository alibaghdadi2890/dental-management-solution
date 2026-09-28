import { cn } from '@/lib/utils';

/** The POC magnifier (search boxes, "Find patient", the ⌘K palette), in the current text colour. */
export function SearchIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={cn('flex-none', className)}
    >
      <circle cx="6.8" cy="6.8" r="4.6" />
      <path d="M10.3 10.3 14 14" />
    </svg>
  );
}
