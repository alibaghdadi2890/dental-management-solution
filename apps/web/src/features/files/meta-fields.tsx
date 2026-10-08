import {
  FILE_CATEGORIES,
  FILE_SUB_CATEGORIES,
  type FileCategory,
  type FileSubCategory,
  formatVisitNumber,
} from '@dcm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/features/auth/use-permission';
import { formatCalendarDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ValueChip } from './tooth-field';
import { useVisitOptions, type VisitOption } from './visit-options';

const CHIP = {
  lg: 'h-10 flex-1 rounded-lg px-3 text-[13px]',
  sm: 'h-[30px] rounded-[7px] px-2.5 text-[12.5px]',
} as const;

const chipTone = (on: boolean) =>
  on
    ? 'border-primary bg-primary-tint text-primary'
    : 'border-border-control bg-surface text-ink-secondary hover:border-primary hover:text-primary';

/**
 * The one mandatory choice (F3): X-ray · Photo · Other, one tap. A radio group — arrow keys move
 * between the chips — that the upload panel also drives with the keys 1, 2 and 3.
 */
export function CategoryChips({
  value,
  onChange,
  size = 'sm',
  labelledBy,
}: {
  value: FileCategory | null;
  onChange: (category: FileCategory) => void;
  size?: keyof typeof CHIP;
  labelledBy: string;
}) {
  const { t } = useTranslation('files');
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex gap-1.5">
      {FILE_CATEGORIES.map((category, index) => {
        const on = value === category;
        return (
          <button
            key={category}
            type="button"
            role="radio"
            aria-checked={on}
            // One Tab stop: the chosen chip, or the first while nothing is chosen.
            tabIndex={on || (value === null && index === 0) ? 0 : -1}
            onClick={() => {
              onChange(category);
            }}
            onKeyDown={(event) => {
              const step =
                event.key === 'ArrowRight' || event.key === 'ArrowDown'
                  ? 1
                  : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                    ? -1
                    : 0;
              if (step === 0) return;
              event.preventDefault();
              const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
              const horizontal = event.key === 'ArrowRight' || event.key === 'ArrowLeft';
              const move = horizontal && rtl ? -step : step;
              const next = FILE_CATEGORIES.at((index + move) % FILE_CATEGORIES.length);
              if (!next) return;
              onChange(next);
              const chips = event.currentTarget.parentElement?.querySelectorAll('button');
              chips?.[FILE_CATEGORIES.indexOf(next)]?.focus();
            }}
            className={cn(
              'cursor-pointer border leading-none font-medium whitespace-nowrap',
              CHIP[size],
              chipTone(on),
            )}
          >
            {t(`category.${category}`)}
          </button>
        );
      })}
    </div>
  );
}

/** The optional type under a category (F3): toggle chips, de-selectable; nothing for "Other". */
export function TypeChips({
  category,
  value,
  onChange,
  labelledBy,
}: {
  category: FileCategory | null;
  value: FileSubCategory | null;
  onChange: (subCategory: FileSubCategory | null) => void;
  labelledBy: string;
}) {
  const { t } = useTranslation('files');
  const types: readonly FileSubCategory[] = category ? FILE_SUB_CATEGORIES[category] : [];
  if (types.length === 0) return null;
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap gap-1.5">
      {types.map((type) => {
        const on = value === type;
        return (
          <button
            key={type}
            type="button"
            aria-pressed={on}
            onClick={() => {
              onChange(on ? null : type);
            }}
            className={cn(
              'cursor-pointer border leading-none font-medium whitespace-nowrap',
              CHIP.sm,
              chipTone(on),
            )}
          >
            {t(`subCategory.${type}`)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The visit a file was taken in (F5): a chip "Visit V-000071 · today ×" when set; else a muted
 * "Not linked to a visit · link" that opens a select of the patient's visits. `known` names the
 * visit when it is not among the options (a pre-filled one, an older one).
 */
export function VisitField({
  patientId,
  value,
  known,
  onChange,
  today,
}: {
  patientId: string;
  value: string | null;
  known?: VisitOption | null | undefined;
  onChange: (visit: VisitOption | null) => void;
  /** The clinic's today, to say "today" for a visit of the day. */
  today: string;
}) {
  const { t, i18n } = useTranslation('files');
  const locale = i18n.resolvedLanguage ?? 'en';
  const canRead = usePermission('visit:read');
  const [choosing, setChoosing] = useState(false);
  const options = useVisitOptions(patientId, choosing || (value !== null && known?.id !== value));
  const dateOf = (visit: VisitOption) =>
    visit.localDate === today ? t('visitField.today') : formatCalendarDate(visit.localDate, locale);

  if (value !== null) {
    const visit = known?.id === value ? known : options.find((option) => option.id === value);
    const number = visit ? formatVisitNumber(visit.displayNumber) : '…';
    return (
      <ValueChip
        removeLabel={t('visitField.remove', { number })}
        onRemove={() => {
          onChange(null);
        }}
      >
        {visit
          ? `${t('visitNumber', { number })}${t('separator')}${dateOf(visit)}`
          : t('visitNumber', { number })}
      </ValueChip>
    );
  }

  if (choosing) {
    return (
      <select
        aria-label={t('visitField.choose')}
        autoFocus
        value=""
        onBlur={() => {
          setChoosing(false);
        }}
        onChange={(event) => {
          const chosen = options.find((option) => option.id === event.target.value);
          setChoosing(false);
          if (chosen) onChange(chosen);
        }}
        className="h-[30px] max-w-full cursor-pointer rounded-md border border-border-control bg-surface px-2 text-[12.5px] leading-none text-ink"
      >
        <option value="">{t('visitField.choose')}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {t('visitField.option', {
              number: formatVisitNumber(option.displayNumber),
              date: option.live ? t('visitField.live') : dateOf(option),
            })}
          </option>
        ))}
      </select>
    );
  }

  return (
    <span className="text-[12.5px] leading-[30px] text-ink-muted">
      {t('visitField.none')}
      {canRead && (
        <>
          {t('separator')}
          <button
            type="button"
            onClick={() => {
              setChoosing(true);
            }}
            className="cursor-pointer border-0 bg-transparent p-0 font-medium text-primary underline"
          >
            {t('visitField.link')}
          </button>
        </>
      )}
    </span>
  );
}
