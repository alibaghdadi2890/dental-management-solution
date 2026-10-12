import { stepsOf, VISIT_TYPES, type VisitType } from '@dcm/contracts';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useStepLabel } from './flow-labels';

/**
 * The Start visit popover's visit types (feature 10, V1): one tile per type with the steps it
 * will show, and a *Suggested* badge on the one the patient's record points at. A radio group:
 * arrows move, the choice follows.
 */
export function VisitTypeTiles({
  value,
  suggested,
  disabled = false,
  onChange,
}: {
  value: VisitType;
  suggested: VisitType | undefined;
  disabled?: boolean;
  onChange: (type: VisitType) => void;
}) {
  const { t } = useTranslation('clinical');
  const stepLabel = useStepLabel();
  const name = useId();
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1.5 p-0 text-[12.5px] leading-none font-medium">
        {t('startVisit.type')}
      </legend>
      <div className="flex flex-col gap-1.5">
        {VISIT_TYPES.map((type) => {
          const on = type === value;
          return (
            <label
              key={type}
              className={cn(
                'relative flex cursor-pointer flex-col gap-1 rounded-[7px] border px-2.5 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary',
                on
                  ? 'border-primary-tint-border bg-primary-tint'
                  : 'border-border-control bg-surface hover:border-ink-muted',
              )}
            >
              <input
                type="radio"
                name={name}
                value={type}
                checked={on}
                disabled={disabled}
                onChange={() => {
                  onChange(type);
                }}
                className="absolute inset-0 m-0 cursor-pointer appearance-none opacity-0"
              />
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'text-[13px] leading-none font-semibold',
                    on ? 'text-primary' : 'text-ink',
                  )}
                >
                  {t(`flow.types.${type}`)}
                </span>
                {type === suggested && (
                  <span className="rounded-[4px] border border-primary-tint-border bg-surface px-1.5 py-[3px] text-[11px] leading-none font-medium text-primary">
                    {t('startVisit.suggested')}
                  </span>
                )}
              </span>
              <span className="text-[11.5px] leading-[1.3] text-ink-muted">
                {stepsOf(type)
                  .map((step) => stepLabel(type, step))
                  .join(' · ')}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
