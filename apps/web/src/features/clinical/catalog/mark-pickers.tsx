import {
  MARK_COLORS,
  MARK_ICONS,
  MARK_PRIORITY_MAX,
  MARK_PRIORITY_MIN,
  type MarkColor,
  type MarkIcon,
  markColorVars,
} from '@dcm/contracts';
import { Popover } from 'radix-ui';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { MarkChip } from '../chart/mark-chip';
import { MarkIconGlyph } from '../chart/mark-icons';

const TRIGGER =
  'grid size-7 flex-none cursor-pointer place-items-center rounded-md border border-border bg-surface p-0 hover:border-border-strong';
const CONTENT =
  'z-50 animate-fadein rounded-[10px] border border-border bg-surface p-3 shadow-[0_10px_28px_rgba(27,26,31,.14)]';
const OPTION =
  'grid size-8 cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 hover:bg-background';
const CHOSEN = 'shadow-[0_0_0_2px_var(--color-primary)]';

function Picker({
  label,
  title,
  trigger,
  children,
}: {
  /** The trigger's accessible name: what it is and its current value. */
  label: string;
  title: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={label} title={label} className={TRIGGER}>
          {trigger}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} aria-labelledby={titleId} className={CONTENT}>
          <h3
            id={titleId}
            className="m-0 mb-2.5 text-[11.5px] leading-none font-medium tracking-[0.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal"
          >
            {title}
          </h3>
          {children(() => {
            setOpen(false);
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The colour a catalog row shows on the dental chart (feature 9, M12): a swatch button that opens
 * the sixteen palette colours in a 4×4 grid. Choosing one closes the popover. Under the grid, the
 * row's chart priority: which marks show first when a tooth has more than fit.
 */
export function ColorPicker({
  name,
  color,
  priority,
  onColor,
  onPriority,
}: {
  /** The row's name, for the button's accessible name. */
  name: string;
  color: MarkColor;
  priority: number;
  onColor: (color: MarkColor) => void;
  onPriority: (priority: number) => void;
}) {
  const { t } = useTranslation('catalog');
  const helpId = useId();
  const step =
    'grid size-7 cursor-pointer place-items-center rounded-md border border-border bg-surface p-0 font-mono text-[14px] leading-none disabled:cursor-default disabled:opacity-40';
  return (
    <Picker
      label={t('mark.color', { name, color: t(`markColor.${color}`) })}
      title={t('mark.colorTitle')}
      trigger={<MarkChip kind="service" color={color} size={16} />}
    >
      {(close) => (
        <>
          <div role="group" aria-label={t('mark.colorTitle')} className="grid grid-cols-4 gap-1">
            {MARK_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === color}
                aria-label={t(`markColor.${option}`)}
                title={t(`markColor.${option}`)}
                data-color={option}
                onClick={() => {
                  onColor(option);
                  close();
                }}
                className={OPTION}
              >
                <span
                  aria-hidden
                  className={cn('size-5 rounded-[5px]', option === color && CHOSEN)}
                  style={{ backgroundColor: markColorVars(option).fill }}
                />
              </button>
            ))}
          </div>
          <div className="mt-3 border-t border-inner-divider pt-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] leading-none font-medium">{t('mark.priority')}</span>
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label={t('mark.priorityDown')}
                  disabled={priority <= MARK_PRIORITY_MIN}
                  onClick={() => {
                    onPriority(priority - 1);
                  }}
                  className={step}
                >
                  −
                </button>
                <output
                  aria-label={t('mark.priority')}
                  aria-describedby={helpId}
                  className="w-5 text-center font-mono text-[13px] leading-none font-semibold tabular-nums"
                >
                  {priority}
                </output>
                <button
                  type="button"
                  aria-label={t('mark.priorityUp')}
                  disabled={priority >= MARK_PRIORITY_MAX}
                  onClick={() => {
                    onPriority(priority + 1);
                  }}
                  className={step}
                >
                  +
                </button>
              </span>
            </div>
            <p
              id={helpId}
              className="m-0 mt-2 max-w-[172px] text-[11.5px] leading-[1.4] text-ink-muted"
            >
              {t('mark.priorityHelp')}
            </p>
          </div>
        </>
      )}
    </Picker>
  );
}

/**
 * The icon a service shows on its chart chip (feature 9, M12): a button holding the icon, or a
 * dashed placeholder, that opens the twelve icons in a 4×3 grid, and **None**.
 */
export function IconPicker({
  name,
  color,
  icon,
  onIcon,
}: {
  name: string;
  /** The row's colour: the icons are shown on it, as on the chart. */
  color: MarkColor;
  icon: MarkIcon | null;
  onIcon: (icon: MarkIcon | null) => void;
}) {
  const { t } = useTranslation('catalog');
  const current = icon === null ? t('mark.noIcon') : t(`markIcon.${icon}`);
  return (
    <Picker
      label={t('mark.icon', { name, icon: current })}
      title={t('mark.iconTitle')}
      trigger={
        icon === null ? (
          <span
            aria-hidden
            className="size-4 rounded-[4px] border border-dashed border-border-strong"
          />
        ) : (
          <MarkChip kind="service" color={color} icon={icon} size={18} />
        )
      }
    >
      {(close) => (
        <div role="group" aria-label={t('mark.iconTitle')}>
          <div className="grid grid-cols-4 gap-1">
            {MARK_ICONS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === icon}
                aria-label={t(`markIcon.${option}`)}
                title={t(`markIcon.${option}`)}
                data-icon={option}
                onClick={() => {
                  onIcon(option);
                  close();
                }}
                className={cn(OPTION, 'text-ink-secondary', option === icon && CHOSEN)}
              >
                <MarkIconGlyph icon={option} size={18} />
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={icon === null}
            data-icon="none"
            onClick={() => {
              onIcon(null);
              close();
            }}
            className={cn(
              'mt-2 h-7 w-full cursor-pointer rounded-md border border-border bg-surface text-[12.5px] leading-none font-medium',
              icon === null && 'border-primary text-primary',
            )}
          >
            {t('mark.noIcon')}
          </button>
        </div>
      )}
    </Picker>
  );
}
