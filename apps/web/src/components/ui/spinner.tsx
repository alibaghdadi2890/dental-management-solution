import { cn } from '@/lib/utils';

export function Spinner({
  tone = 'light',
  className,
}: {
  tone?: 'light' | 'dark';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'size-3.5 flex-none animate-spin rounded-full border-2',
        tone === 'light'
          ? 'border-white/35 border-t-white'
          : 'border-border-control border-t-ink-secondary',
        className,
      )}
    />
  );
}
