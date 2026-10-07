import { TOOTH_PRESENCE_STATES, type ToothCode, type ToothPresenceState } from '@dcm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from '@/components/ui/menu';
import { useToothLabel } from '../chart/use-chart-settings';
import { useChartingActions } from '../workspace/charting-actions';
import { PresenceDialog } from './presence-dialog';

const isState = (value: string): value is ToothPresenceState =>
  TOOTH_PRESENCE_STATES.some((state) => state === value);

/**
 * The quiet Presence control beside the tooth's title (feature 7, H1): "Present ▾", "Missing ▾",
 * "Not erupted ▾" or "Implant ▾". In a live visit a choice applies at once, dated by the visit —
 * cheap to reverse, so no dialog, just the toast with Undo. On the patient record it first asks
 * when, why and for which dentist (`PresenceDialog`).
 */
export function PresenceMenu({
  code,
  presence,
}: {
  code: ToothCode;
  presence: ToothPresenceState;
}) {
  const { t } = useTranslation('clinical');
  const actions = useChartingActions();
  const label = useToothLabel();
  // The value chosen on the patient record, while its dialog is open.
  const [asking, setAsking] = useState<ToothPresenceState | null>(null);
  const tooth = label(code).replace(/^#/, '');

  const choose = (value: string) => {
    if (!isState(value) || value === presence) return;
    if (actions.scope.kind === 'visit') {
      void actions.setPresence([{ toothCode: code, presence: value }]);
      return;
    }
    setAsking(value);
  };

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={t('presence.menuLabel', {
              label: tooth,
              state: t(`presence.states.${presence}`),
            })}
            className="inline-flex h-[22px] cursor-pointer items-center gap-1 rounded-[5px] border border-border-control bg-surface px-1.5 text-[11.5px] leading-none font-medium text-ink-secondary hover:border-ink hover:text-ink"
          >
            {t(`presence.states.${presence}`)}
            <svg
              aria-hidden
              width="8"
              height="8"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="m2 3.5 3 3 3-3" />
            </svg>
          </button>
        </MenuTrigger>
        <MenuContent align="start" className="w-[168px]">
          <MenuRadioGroup value={presence} onValueChange={choose}>
            {TOOTH_PRESENCE_STATES.map((state) => (
              <MenuRadioItem key={state} value={state}>
                {t(`presence.states.${state}`)}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
      {asking !== null && (
        <PresenceDialog
          title={t('presence.popover.title', {
            label: tooth,
            state: t(`presence.states.${asking}`).toLocaleLowerCase(),
          })}
          onSave={(details) =>
            actions.setPresence([{ toothCode: code, presence: asking }], details)
          }
          onClose={() => {
            setAsking(null);
          }}
        />
      )}
    </>
  );
}
