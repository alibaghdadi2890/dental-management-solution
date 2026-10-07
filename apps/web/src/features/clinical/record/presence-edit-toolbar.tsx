import type { ToothPresenceState } from '@dcm/contracts';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PRESENCE_BRUSHES } from './presence-edit';

/**
 * The floating toolbar of Edit presence (feature 7): the active brush — Missing · Not erupted ·
 * Implant · Present — a counter of the changes so far, **Done** (which asks once when, why and
 * for which dentist, for the whole batch) and **Cancel**. It stays in view at the foot of the
 * chart card while the chart scrolls.
 */
export function PresenceEditToolbar({
  brush,
  count,
  onBrush,
  onDone,
  onCancel,
}: {
  brush: ToothPresenceState;
  count: number;
  onBrush: (brush: ToothPresenceState) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(['clinical', 'common']);
  const labelId = useId();
  return (
    <div className="sticky bottom-3 z-10 mt-4 flex justify-center">
      <div
        role="toolbar"
        aria-label={t('presence.edit.start')}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-surface px-3 py-2 shadow-[0_10px_28px_rgba(27,26,31,.16)]"
      >
        <span id={labelId} className="text-[12.5px] leading-none font-medium text-ink-secondary">
          {t('presence.edit.toolbar')}
        </span>
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          className="flex gap-0.5 rounded-lg border border-border-control bg-sunken p-0.5"
        >
          {PRESENCE_BRUSHES.map((state) => (
            <button
              key={state}
              type="button"
              role="radio"
              aria-checked={brush === state}
              onClick={() => {
                onBrush(state);
              }}
              className={cn(
                'h-[30px] cursor-pointer rounded-[6px] border-0 px-2.5 text-[12.5px] leading-none font-medium whitespace-nowrap',
                brush === state
                  ? 'bg-ink text-white'
                  : 'bg-transparent text-ink-secondary hover:text-ink',
              )}
            >
              {t(`presence.states.${state}`)}
            </button>
          ))}
        </div>
        <span
          role="status"
          className="min-w-[78px] font-mono text-[12.5px] leading-none text-ink-secondary tabular-nums"
        >
          {count === 0 ? t('presence.edit.hint') : t('presence.edit.changes', { count })}
        </span>
        <span className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {t('common:cancel')}
          </Button>
          <Button variant="primary" size="sm" disabled={count === 0} onClick={onDone}>
            {t('presence.edit.done')}
          </Button>
        </span>
      </div>
    </div>
  );
}
