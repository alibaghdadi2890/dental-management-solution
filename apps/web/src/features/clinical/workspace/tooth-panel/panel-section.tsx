import { type ReactNode, useId } from 'react';
import { cn } from '@/lib/utils';

export type SectionTone = 'diagnosis' | 'plan' | 'completed';

/** Each stage label in its stage colour (spec §Diagnosis → Treatment Plan → Completed). */
const TONE: Record<SectionTone, { text: string; stroke: string }> = {
  diagnosis: { text: 'text-danger', stroke: 'stroke-danger' },
  plan: { text: 'text-warning', stroke: 'stroke-warning' },
  completed: { text: 'text-primary', stroke: 'stroke-primary' },
};

/**
 * One collapsible stage of the tooth panel (spec §Selected Tooth Panel → Body): a header row
 * with a 10px caret (rotating a quarter turn when closed), the stage label as a micro label in
 * its colour, a one-line summary in muted ink **only while collapsed**, and an optional
 * **+ Add** at the end. Open by default; the parent owns the open state so it survives a change
 * of tooth.
 */
export function PanelSection({
  tone,
  label,
  summary,
  open,
  onToggle,
  add,
  children,
}: {
  tone: SectionTone;
  label: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  /** The section's **+ Add** (absent when read-only, W18). */
  add?: { label: string; name: string; onClick: () => void } | undefined;
  children: ReactNode;
}) {
  const bodyId = useId();
  const { text, stroke } = TONE[tone];
  return (
    <section aria-label={label} className="mb-[18px] last:mb-0">
      <div className="mb-[9px] flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={onToggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-start select-none"
        >
          <span
            aria-hidden
            className={cn(
              'grid size-3.5 flex-none place-items-center transition-transform duration-[160ms] ease-in-out',
              !open && '-rotate-90 rtl:rotate-90',
            )}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" strokeWidth="2">
              <path className={stroke} d="M3.5 6 8 10.5 12.5 6" />
            </svg>
          </span>
          <span
            className={cn(
              'flex-none text-[11.5px] leading-none font-medium tracking-[.05em] uppercase [&:lang(ar)]:tracking-normal',
              text,
            )}
          >
            {label}
          </span>
          {!open && (
            <span className="min-w-0 truncate text-[12.5px] leading-[1.3] text-ink-muted">
              {summary}
            </span>
          )}
        </button>
        {add && (
          <button
            type="button"
            aria-label={add.name}
            onClick={add.onClick}
            className="ms-auto flex-none cursor-pointer border-0 bg-transparent p-0 text-[12.5px] leading-none font-medium text-primary hover:underline"
          >
            {add.label}
          </button>
        )}
      </div>
      {open && <div id={bodyId}>{children}</div>}
    </section>
  );
}

/** The dashed block a stage shows when the tooth has nothing in it. */
export function EmptyBlock({
  title,
  body,
  action,
}: {
  title: string;
  body?: string | undefined;
  action?: { label: string; onClick: () => void } | undefined;
}) {
  return (
    <div className="rounded-lg border border-dashed border-divider-strong bg-faint px-3.5 py-[18px] text-center">
      <div className="mb-1 text-[12.5px] leading-[1.35] font-medium">{title}</div>
      {body && (
        <div className={cn('text-[12.5px] leading-normal text-ink-muted', action && 'mb-3')}>
          {body}
        </div>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="h-8 cursor-pointer rounded-[7px] border border-border-control bg-surface px-[13px] text-[12.5px] leading-none font-medium hover:border-border-strong"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** A small text button in a record's action row (Resolve, Remove…). */
export function LinkButton({
  label,
  name,
  tone = 'primary',
  onClick,
  className,
}: {
  label: string;
  /** The accessible name when the visible label alone is ambiguous ("Remove Dental caries"). */
  name?: string;
  tone?: 'primary' | 'danger';
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={name}
      onClick={onClick}
      className={cn(
        'flex-none cursor-pointer border-0 bg-transparent p-0 text-[12.5px] leading-none font-medium hover:underline',
        tone === 'danger' ? 'text-danger' : 'text-primary',
        className,
      )}
    >
      {label}
    </button>
  );
}

/** A tiny status badge (Active, Resolved, Planned, From plan, Primary). */
export function Badge({
  tone,
  children,
}: {
  tone: 'danger' | 'success' | 'warning' | 'neutral';
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'flex-none rounded-[4px] border px-[7px] py-[3px] text-[11.5px] leading-none font-medium',
        tone === 'danger' && 'border-danger-border bg-danger-bg text-danger',
        tone === 'success' && 'border-success-border bg-success-bg text-success',
        tone === 'warning' && 'border-warning-border bg-warning-bg text-warning',
        tone === 'neutral' && 'border-border bg-subtle text-ink-secondary',
      )}
    >
      {children}
    </span>
  );
}
