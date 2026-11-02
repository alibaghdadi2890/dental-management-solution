import { cn } from '@/lib/utils';

/** The stepper of the Complete and Checkout dialogs: where we are, not a way to jump. */
export function DialogSteps({
  steps,
  current,
  className,
}: {
  steps: readonly string[];
  current: number;
  className?: string;
}) {
  return (
    <ol className={cn('m-0 flex list-none items-center gap-1.5 p-0 text-[12px]', className)}>
      {steps.map((step, index) => (
        <li
          key={step}
          aria-current={index === current ? 'step' : undefined}
          className={cn(
            'flex items-center gap-1.5',
            index === current ? 'font-semibold text-primary' : 'text-ink-muted',
          )}
        >
          {index > 0 ? <span aria-hidden>·</span> : null}
          {index < current ? <span aria-hidden>{'✓'}</span> : null}
          {step}
        </li>
      ))}
    </ol>
  );
}
