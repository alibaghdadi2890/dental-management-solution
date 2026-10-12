import { cn } from '@/lib/utils';

const SIZE = {
  /** The record header and the quick view. */
  sm: 'gap-[5px] px-[9px] py-[5px] text-[11.5px] font-medium',
  /** The visit header, read from across the chair. */
  lg: 'gap-1.5 px-2.5 py-1.5 text-[14px] font-semibold',
} as const;

function AlertIcon() {
  return (
    <svg
      aria-hidden
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className="flex-none"
    >
      <path d="M8 2.5 14.5 13.5H1.5L8 2.5Z" />
      <path d="M8 6.6v3" />
      <path d="M8 11.4h.01" />
    </svg>
  );
}

/**
 * A patient's medical alerts as chips (feature 10): allergies in red, with the warning icon,
 * then conditions in amber. Nothing when the patient has neither.
 */
export function AlertChips({
  allergies,
  conditions,
  label,
  size = 'sm',
  className,
}: {
  allergies: readonly string[];
  conditions: readonly string[];
  /** The list's accessible name. */
  label: string;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  if (allergies.length === 0 && conditions.length === 0) return null;
  const chip = cn('inline-flex items-center rounded-md border leading-none', SIZE[size]);
  return (
    <ul aria-label={label} className={cn('m-0 flex list-none flex-wrap gap-[7px] p-0', className)}>
      {allergies.map((name) => (
        <li
          key={`allergy:${name}`}
          data-alert="allergy"
          className={cn(chip, 'border-danger-border bg-danger-bg text-danger')}
        >
          <AlertIcon />
          {name}
        </li>
      ))}
      {conditions.map((name) => (
        <li
          key={`condition:${name}`}
          data-alert="condition"
          className={cn(chip, 'border-warning-border bg-warning-bg text-warning')}
        >
          {name}
        </li>
      ))}
    </ul>
  );
}
