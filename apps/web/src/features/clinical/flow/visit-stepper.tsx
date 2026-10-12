import {
  isOptionalStep,
  VISIT_VIEW_MODES,
  type VisitStep,
  type VisitViewMode,
} from '@dcm/contracts';
import { Fragment, type KeyboardEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useStepLabel } from './flow-labels';
import type { VisitFlow } from './use-visit-flow';

/** The arrow keys of a horizontal list; the page's direction decides which one is "next". */
function arrowStep(event: KeyboardEvent<HTMLElement>): number {
  const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    return event.key === 'ArrowRight' && rtl ? -1 : 1;
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    return event.key === 'ArrowLeft' && rtl ? 1 : -1;
  }
  return 0;
}

/**
 * The visit's stepper band (feature 10, V2): one button per step — its number, or a tick once
 * something was recorded in it — and, at its end, the **Steps | All** toggle. A step the visit
 * is not expected to fill (Perform, in an examination) reads "optional". It is navigation,
 * never a gate: every step opens at any time, in the All view too (which then returns to the
 * steps). Each step is a tab stop; the arrow keys also move between them, and Enter opens the
 * focused one;
 * the step the visit is on is `aria-current="step"`.
 */
export function VisitStepper({ flow }: { flow: VisitFlow }) {
  const { t } = useTranslation('clinical');
  const stepLabel = useStepLabel();
  const buttons = useRef(new Map<VisitStep, HTMLButtonElement>());
  const views = useRef(new Map<VisitViewMode, HTMLButtonElement>());
  const inSteps = flow.view === 'steps';

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const target =
      event.key === 'Home'
        ? flow.steps[0]
        : event.key === 'End'
          ? flow.steps.at(-1)
          : flow.steps[index + arrowStep(event)];
    if (target === undefined || target === flow.steps[index]) return;
    event.preventDefault();
    buttons.current.get(target)?.focus();
  };

  return (
    <div className="flex flex-none items-center gap-3 border-b border-border bg-surface px-[22px] py-2">
      <nav
        aria-label={t('flow.stepper', { type: t(`flow.types.${flow.type}`) })}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5"
      >
        {flow.steps.map((step, index) => {
          const current = inSteps && step === flow.current;
          const done = flow.done.has(step);
          return (
            <Fragment key={step}>
              {index > 0 && (
                <span aria-hidden className="h-px w-[18px] flex-none bg-border-control" />
              )}
              <button
                ref={(node) => {
                  if (node) buttons.current.set(step, node);
                  else buttons.current.delete(step);
                }}
                type="button"
                aria-current={current ? 'step' : undefined}
                data-done={done || undefined}
                onClick={() => {
                  flow.goTo(step);
                }}
                onKeyDown={(event) => {
                  onKeyDown(event, index);
                }}
                className={cn(
                  'flex h-8 flex-none cursor-pointer items-center gap-2 rounded-2xl border py-0 ps-[5px] pe-3 text-[13px] leading-none whitespace-nowrap',
                  current
                    ? 'border-primary-tint-border bg-selected font-semibold text-primary'
                    : 'border-transparent bg-transparent font-medium hover:bg-faint',
                  !current && (done ? 'text-ink' : 'text-ink-tertiary'),
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid size-[22px] flex-none place-items-center rounded-full border font-mono text-[11.5px] leading-none font-semibold',
                    done
                      ? 'border-success bg-success text-white'
                      : current
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border-control bg-surface text-ink-muted',
                  )}
                >
                  {done ? '✓' : index + 1}
                </span>
                {stepLabel(flow.type, step)}
                {isOptionalStep(flow.type, step) && !done && (
                  <span className="text-[11.5px] font-normal text-ink-muted">
                    {t('flow.optional')}
                  </span>
                )}
                {done && <span className="sr-only">{t('flow.stepDone')}</span>}
              </button>
            </Fragment>
          );
        })}
      </nav>
      <div
        role="radiogroup"
        aria-label={t('flow.view.label')}
        className="flex flex-none gap-px rounded-[7px] border border-border bg-subtle p-0.5"
      >
        {VISIT_VIEW_MODES.map((mode) => {
          const on = flow.view === mode;
          return (
            <button
              key={mode}
              ref={(node) => {
                if (node) views.current.set(mode, node);
                else views.current.delete(mode);
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => {
                flow.setView(mode);
              }}
              onKeyDown={(event) => {
                // A radio group of two: either arrow checks the other one.
                if (arrowStep(event) === 0) return;
                event.preventDefault();
                const other = mode === 'steps' ? 'all' : 'steps';
                flow.setView(other);
                views.current.get(other)?.focus();
              }}
              className={cn(
                'h-7 cursor-pointer rounded-[5px] border-0 px-3 text-[12.5px] leading-none font-medium',
                on
                  ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(27,26,31,.12)]'
                  : 'bg-transparent text-ink-muted hover:text-ink',
              )}
            >
              {t(`flow.view.${mode}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
