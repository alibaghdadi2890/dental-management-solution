import {
  DENTITION_STAGES,
  type DentitionStage,
  parseTooth,
  type ToothCode,
  type ToothState,
} from '@dcm/contracts';
import { Popover } from 'radix-ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DentalChart } from '@/features/clinical/chart/dental-chart';
import { useChartSettings, useToothLabel } from '@/features/clinical/chart/use-chart-settings';
import { cn } from '@/lib/utils';
import { useFileText } from './file-text';

const NO_TEETH: ReadonlyMap<ToothCode, ToothState> = new Map();

/** A removable chip: a pre-filled or chosen value that is shown, never hidden (F5). */
export function ValueChip({
  children,
  removeLabel,
  onRemove,
}: {
  children: string;
  removeLabel: string;
  /** Without it the chip is read-only. */
  onRemove?: (() => void) | undefined;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[26px] max-w-full items-center gap-1 rounded-md border ps-2 text-[12px] leading-none font-medium',
        'border-primary-tint-border bg-primary-tint text-primary',
        onRemove ? 'pe-0.5' : 'pe-2',
      )}
    >
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="grid size-5 flex-none cursor-pointer place-items-center rounded border-0 bg-transparent text-current opacity-70 hover:opacity-100"
        >
          <svg
            aria-hidden
            width="8"
            height="8"
            viewBox="0 0 10 10"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="m2 2 6 6M8 2 2 8" />
          </svg>
        </button>
      )}
    </span>
  );
}

/**
 * The tooth a file is of (feature 8): a chip "Tooth #36 ×" once chosen; until then a short number
 * field in the clinic's notation — either dentition — and a button that opens the chart to pick
 * the tooth from. One tooth, or none.
 */
export function ToothField({
  value,
  onChange,
  label,
}: {
  value: ToothCode | null;
  onChange: (tooth: ToothCode | null) => void;
  /** The field's accessible name. */
  label: string;
}) {
  const { t } = useTranslation(['files', 'clinical']);
  const text = useFileText();
  const toothLabel = useToothLabel();
  const { notation } = useChartSettings();
  const errorId = useId();
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<DentitionStage>('permanent');

  if (value !== null) {
    return (
      <ValueChip
        removeLabel={t('toothField.remove', { tooth: toothLabel(value) })}
        onRemove={() => {
          setDraft('');
          onChange(null);
        }}
      >
        {text.tooth(value)}
      </ValueChip>
    );
  }

  const commit = () => {
    if (draft.trim() === '') {
      setInvalid(false);
      return;
    }
    const parsed = parseTooth(draft, notation);
    setInvalid(parsed === null);
    if (parsed !== null) onChange(parsed);
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        value={draft}
        inputMode="text"
        maxLength={4}
        placeholder={t('toothField.placeholder')}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          // Enter sets the tooth; it must not also save the panel.
          event.preventDefault();
          event.stopPropagation();
          commit();
        }}
        className="h-[30px] w-[58px] rounded-md border border-border-control bg-surface px-2 font-mono text-[12.5px] leading-none aria-invalid:border-danger"
      />
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={t('toothField.pick')}
            title={t('toothField.pick')}
            className="grid size-[30px] cursor-pointer place-items-center rounded-md border border-border-control bg-surface text-ink-secondary hover:border-primary hover:text-primary"
          >
            <svg
              aria-hidden
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            >
              <rect x="2" y="2" width="5" height="5" rx="1" />
              <rect x="9" y="2" width="5" height="5" rx="1" />
              <rect x="2" y="9" width="5" height="5" rx="1" />
              <rect x="9" y="9" width="5" height="5" rx="1" />
            </svg>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            aria-label={t('toothField.chartTitle')}
            className="z-[70] max-w-[calc(100vw-24px)] animate-fadein overflow-auto rounded-[10px] border border-border bg-surface p-3.5 shadow-[0_10px_28px_rgba(27,26,31,.14)]"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-[13px] leading-none font-semibold">
                {t('toothField.chartTitle')}
              </span>
              <span
                role="group"
                aria-label={t('clinical:dentition.label')}
                className="inline-flex gap-0.5 rounded-[7px] border border-border bg-subtle p-0.5"
              >
                {DENTITION_STAGES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={option === stage}
                    onClick={() => {
                      setStage(option);
                    }}
                    className={cn(
                      'h-[22px] cursor-pointer rounded-[5px] border-0 px-2 text-[12px] leading-none font-medium',
                      option === stage
                        ? 'bg-surface font-semibold text-primary shadow-[0_1px_2px_rgba(27,26,31,.08)]'
                        : 'bg-transparent text-ink-secondary hover:text-ink',
                    )}
                  >
                    {t(`clinical:dentition.stage.${option}`)}
                  </button>
                ))}
              </span>
            </div>
            <DentalChart
              teeth={NO_TEETH}
              dentition={stage}
              size={8}
              selected={null}
              onToothClick={(code) => {
                setOpen(false);
                setInvalid(false);
                onChange(code);
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {invalid && (
        <span
          id={errorId}
          role="alert"
          className="text-[12px] leading-none font-medium text-danger"
        >
          {t('toothField.invalid')}
        </span>
      )}
    </span>
  );
}
