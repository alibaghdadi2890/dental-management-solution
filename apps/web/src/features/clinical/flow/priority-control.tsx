import { PLAN_PRIORITIES, type PlanPriority } from '@dcm/contracts';
import { type KeyboardEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** The checked segment, in its priority's tone. */
const ON: Record<PlanPriority, string> = {
  urgent: 'bg-danger text-white',
  high: 'bg-warning text-white',
  elective: 'bg-ink text-white',
};

/**
 * A plan's priority as a three-way segmented control (feature 10, V7): Urgent · High · Elective,
 * a radio group — the checked one takes the tab stop and the arrow keys move it.
 */
export function PriorityControl({
  value,
  label,
  disabled = false,
  onChange,
}: {
  value: PlanPriority;
  /** What it is the priority of, for a screen reader. */
  label: string;
  disabled?: boolean;
  onChange: (priority: PlanPriority) => void;
}) {
  const { t } = useTranslation('clinical');
  const radios = useRef(new Map<PlanPriority, HTMLButtonElement>());
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const forward = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') || event.key === 'ArrowDown';
    const back = event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') || event.key === 'ArrowUp';
    if (!forward && !back) return;
    event.preventDefault();
    const count = PLAN_PRIORITIES.length;
    const next =
      PLAN_PRIORITIES[(PLAN_PRIORITIES.indexOf(value) + (forward ? 1 : -1) + count) % count];
    if (next === undefined) return;
    onChange(next);
    radios.current.get(next)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid grid-cols-3 gap-0.5 rounded-[7px] border border-border bg-subtle p-0.5"
    >
      {PLAN_PRIORITIES.map((priority) => {
        const on = priority === value;
        return (
          <button
            key={priority}
            ref={(node) => {
              if (node) radios.current.set(priority, node);
              else radios.current.delete(priority);
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              if (!on) onChange(priority);
            }}
            onKeyDown={onKeyDown}
            className={cn(
              'h-7 cursor-pointer rounded-[5px] border-0 px-1.5 text-[12px] leading-none font-medium disabled:cursor-default',
              on ? ON[priority] : 'bg-transparent text-ink-secondary hover:text-ink',
            )}
          >
            {t(`flow.priority.${priority}`)}
          </button>
        );
      })}
    </div>
  );
}
