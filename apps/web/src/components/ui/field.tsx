import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useId,
} from 'react';
import { cn } from '@/lib/utils';

const control =
  'w-full rounded-lg border border-border-control bg-surface px-[11px] text-[13px] leading-none text-ink aria-invalid:border-danger';

export const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { inputSize?: 'md' | 'lg' }
>(function TextInput({ className, inputSize = 'md', ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(control, inputSize === 'lg' ? 'h-10 text-[13.5px]' : 'h-9', className)}
      {...props}
    />
  );
});

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, 'h-9 cursor-pointer pe-2', className)} {...props}>
      {children}
    </select>
  );
}

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  /** The quiet **!** (`InfoMark`) beside the label, outside it: it never joins the field's name. */
  info?: ReactNode;
  error?: string | undefined;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby'?: string;
  }) => ReactNode;
  className?: string;
}

/** POC form field: 12.5px/500 label with an optional right-aligned hint, inline error in danger red. */
export function Field({ label, hint, info, error, children, className }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const labelElement = (
    <label
      htmlFor={id}
      className={cn(
        'flex justify-between text-[12.5px] leading-none font-medium',
        info === undefined ? 'mb-1.5' : 'flex-1',
      )}
    >
      <span>{label}</span>
      {hint && <span className="font-normal text-ink-muted">{hint}</span>}
    </label>
  );
  return (
    <div className={cn('block', className)}>
      {info === undefined ? (
        labelElement
      ) : (
        <div className="mb-1.5 flex items-center gap-1.5">
          {labelElement}
          {info}
        </div>
      )}
      {children({
        id,
        'aria-invalid': Boolean(error),
        ...(error ? { 'aria-describedby': errorId } : {}),
      })}
      {error && (
        <span id={errorId} className="mt-[5px] block text-xs leading-tight font-medium text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

/** 11.5px uppercase section eyebrow used in panels. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'text-[11.5px] leading-none font-medium tracking-[0.06em] text-ink-muted uppercase',
        className,
      )}
    >
      {children}
    </div>
  );
}
