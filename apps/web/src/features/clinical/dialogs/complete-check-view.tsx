import type { PatientChart, Visit } from '@dcm/contracts';
import { Dialog } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSessionLabel } from '../flow/flow-labels';
import { useTargetLabel } from '../flow/use-target-label';
import {
  type CheckDecisions,
  checkDecisions,
  choiceOf,
  completeCheck,
  shownBy,
  type WorkChoice,
  type WorkToFinish,
} from './complete-check';

const SECTION_HEAD =
  'm-0 mb-2 text-[11.5px] leading-none font-semibold tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal';

/**
 * The check before a visit is completed (ADR-0065), the body of a dialog: the move from a step to
 * Complete (`BeforeCompleteDialog`), or the Visit Summary in place of the summary. **Work done
 * today** asks, of each piece of work whose end is still to say, **Finished** or **Continues**,
 * starting on `completeCheck`'s suggestion; **Diagnoses still open** lists those on the teeth of
 * the work that is done as the switches stand, each with **Resolve** — ticked when a Finished
 * plan treats it. Read from the live visit and chart, so what a failed apply already did leaves
 * the lists. The back button returns with nothing changed; the primary one applies the answers
 * (`onConfirm`, with everything listed) and goes on.
 */
export function CompleteCheckView({
  visit,
  chart,
  shown,
  busy,
  error,
  backLabel,
  confirmLabel,
  onBack,
  onConfirm,
}: {
  visit: Visit;
  chart: PatientChart;
  /** What an earlier check of the page listed: not asked again. */
  shown?: ReadonlySet<string> | undefined;
  /** Applying or moving on: the controls are disabled. */
  busy: boolean;
  error: string | null;
  backLabel: string;
  /** The primary button, for how many changes the answers make (0: go on as things are). */
  confirmLabel: (changes: number) => string;
  onBack: () => void;
  onConfirm: (decisions: CheckDecisions, listed: string[]) => void;
}) {
  const { t } = useTranslation('clinical');
  const placeLabel = useTargetLabel();
  // The body changed under the user: say so by moving focus to the new title.
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  const [choices, setChoices] = useState<ReadonlyMap<string, WorkChoice>>(new Map());
  const [ticks, setTicks] = useState<ReadonlyMap<string, boolean>>(new Map());
  const check = completeCheck(visit, chart, choices, shown);
  const ticked = (recordId: string) => ticks.get(recordId) ?? check.suggested.has(recordId);
  const decisions = checkDecisions(check, choices, ticked);
  const changes = decisions.finish.length + decisions.unfinish.length + decisions.resolve.length;

  return (
    <>
      <div className="border-b border-inner-divider px-[22px] pt-[18px] pb-[15px]">
        <Dialog.Title
          ref={title}
          tabIndex={-1}
          className="m-0 mb-[3px] text-[16.5px] leading-[1.2] font-semibold tracking-[-0.01em] outline-none"
        >
          {t('summary.check.title')}
        </Dialog.Title>
        <Dialog.Description className="m-0 text-[12.5px] leading-snug text-ink-muted">
          {t('summary.check.subtitle')}
        </Dialog.Description>
      </div>
      <div className="flex max-h-[56vh] flex-col gap-[18px] overflow-auto px-[22px] py-[18px]">
        {check.work.length > 0 && (
          <section aria-labelledby="check-work">
            <h3 id="check-work" className={SECTION_HEAD}>
              {t('summary.check.work')}
            </h3>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {check.work.map((item) => (
                <WorkRow
                  key={item.key}
                  item={item}
                  choice={choiceOf(item, choices)}
                  busy={busy}
                  onChoose={(choice) => {
                    setChoices((current) => new Map(current).set(item.key, choice));
                  }}
                />
              ))}
            </ul>
          </section>
        )}
        {check.diagnoses.length > 0 && (
          <section aria-labelledby="check-diagnoses">
            <h3 id="check-diagnoses" className={SECTION_HEAD}>
              {t('summary.check.diagnoses')}
            </h3>
            <p
              role="note"
              className="m-0 mb-3 rounded-lg border border-warning-border bg-warning-bg px-3.5 py-2.5 text-[12.5px] leading-snug font-medium text-warning"
            >
              {t('summary.resolve.warning', { count: check.diagnoses.length })}
            </p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {check.diagnoses.map(({ record, done }) => {
                const on = ticked(record.id);
                return (
                  <li key={record.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-start gap-2.5 rounded-[9px] border px-3.5 py-3',
                        on ? 'border-success-border bg-success-bg' : 'border-border bg-faint',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={busy}
                        aria-label={t('summary.resolve.tick', {
                          name: record.name,
                          tooth: placeLabel(record),
                        })}
                        onChange={(event) => {
                          const next = event.target.checked;
                          setTicks((current) => new Map(current).set(record.id, next));
                        }}
                        className="m-0 mt-0.5 size-[18px] flex-none accent-success"
                      />
                      <span className="flex-1">
                        <span className="block text-[13px] leading-[1.35] font-semibold">
                          <span dir="ltr" className="font-mono">
                            {placeLabel(record)}
                          </span>
                          {' · '}
                          {record.name}
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-snug text-ink-muted">
                          {t('summary.resolve.doneToday', {
                            services: done.map((item) => item.name).join(', '),
                          })}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'flex-none text-[12px] font-medium',
                          on ? 'text-success' : 'text-ink-muted',
                        )}
                      >
                        {t('summary.resolve.resolve')}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
      {error !== null && (
        <p
          role="alert"
          className="m-0 border-t border-danger-border bg-danger-bg px-[22px] py-2.5 text-[12.5px] leading-snug font-medium text-danger"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-inner-divider bg-sunken px-[22px] py-3.5">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={onBack}
          className="h-[38px] text-[13px]"
        >
          {backLabel}
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            onConfirm(decisions, shownBy(check));
          }}
          className="h-[38px] px-[17px] text-[13px] font-semibold disabled:cursor-wait disabled:opacity-80"
        >
          {busy ? t('summary.resolve.working') : confirmLabel(changes)}
        </Button>
      </div>
    </>
  );
}

const CHOICES: readonly WorkChoice[] = ['finished', 'continues'];

const CHOSEN: Record<WorkChoice, string> = {
  finished: 'bg-success-bg text-success border-success-border',
  continues: 'bg-warning-bg text-warning border-warning-border',
};

/** One piece of today's work: where, what, its session, and the Finished | Continues switch. */
function WorkRow({
  item,
  choice,
  busy,
  onChoose,
}: {
  item: WorkToFinish;
  choice: WorkChoice;
  busy: boolean;
  onChoose: (choice: WorkChoice) => void;
}) {
  const { t } = useTranslation('clinical');
  const placeLabel = useTargetLabel();
  const sessionLabel = useSessionLabel();
  const session = sessionLabel({
    sessionNumber: item.session,
    estimatedSessions: item.estimatedSessions,
  });
  return (
    <li
      data-check-work={item.id}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[9px] border border-border bg-faint px-3.5 py-2.5"
    >
      <span
        dir={item.toothCode === null ? undefined : 'ltr'}
        className="min-w-[38px] flex-none font-mono text-[13px] leading-none font-bold text-primary"
      >
        {placeLabel(item)}
      </span>
      <span className="min-w-0 flex-[1_1_140px]">
        <span className="block text-[13px] leading-[1.35] font-semibold">{item.name}</span>
        {session && (
          <span className="block text-[12px] leading-snug text-ink-muted">{session}</span>
        )}
      </span>
      <span
        role="radiogroup"
        aria-label={t('summary.check.choiceFor', { name: item.name, target: placeLabel(item) })}
        className="ms-auto inline-flex flex-none gap-1"
      >
        {CHOICES.map((option) => {
          const on = choice === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy}
              onClick={() => {
                onChoose(option);
              }}
              className={cn(
                'h-7 cursor-pointer rounded-md border px-2.5 text-[12.5px] leading-none font-medium disabled:cursor-default',
                on
                  ? CHOSEN[option]
                  : 'border-border-control bg-surface text-ink-secondary hover:border-ink',
              )}
            >
              {t(`summary.check.${option}`)}
            </button>
          );
        })}
      </span>
    </li>
  );
}
