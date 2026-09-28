import { type ReactNode, useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * POC content card (workspace spec §Screen 3): white, 1px border, 10px radius, 16px 18px padding,
 * a 600/14px title with an optional action (a "Complete →" link) on the other side. A labelled
 * region, named by its title.
 */
export function Card({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn('rounded-xl border border-border bg-surface px-[18px] py-4', className)}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id={titleId} className="m-0 text-[14px] leading-none font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const SKELETON_WIDTHS = ['38%', '72%', '60%', '44%'] as const;

/** Loading bars inside the destination card (workspace spec §Loading: 11px bars, 4px radius,
 * alternating `#eee9df` / `#f2efe8`, widths 38 / 72 / 60 / 44%, 10px apart) — no spinner. */
export function CardSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="flex flex-col gap-2.5">
      {SKELETON_WIDTHS.map((width, index) => (
        <span
          key={width}
          className={cn(
            'block h-[11px] rounded-[4px]',
            index % 2 === 0 ? 'bg-inner-divider' : 'bg-row-divider',
          )}
          style={{ width }}
        />
      ))}
    </div>
  );
}
