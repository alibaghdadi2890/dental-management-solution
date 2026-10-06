import type { VisitService } from '@dcm/contracts';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { useChartingActions } from './charting-actions';

/** The three-dot menu of a service row: its less common actions, named after the row. */
export function RowMenu({ name, children }: { name: string; children: ReactNode }) {
  const { t } = useTranslation('clinical');
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={t('rowMenu.label', { name })}
          className="grid size-7 flex-none cursor-pointer place-items-center rounded-md border border-transparent bg-transparent p-0 text-ink-muted hover:border-border-control hover:text-ink data-[state=open]:border-border-control data-[state=open]:bg-surface data-[state=open]:text-ink"
        >
          <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="3" r="1.4" />
            <circle cx="8" cy="8" r="1.4" />
            <circle cx="8" cy="13" r="1.4" />
          </svg>
        </button>
      </MenuTrigger>
      <MenuContent>{children}</MenuContent>
    </Menu>
  );
}

/**
 * A service of this visit: **Not finished** (unfinished spec U2: it leaves today's charges and
 * carries on to the visit that completes it) and **Remove**. Nothing while its removal is in
 * flight.
 */
export function ServiceMenu({ service }: { service: VisitService }) {
  const { t } = useTranslation('clinical');
  const actions = useChartingActions();
  const busy = actions.removing.has(service.id);
  return (
    <RowMenu name={service.name}>
      <MenuItem
        disabled={busy}
        onSelect={() => {
          actions.markUnfinished(service);
        }}
      >
        {t('unfinished.mark')}
      </MenuItem>
      <MenuItem
        tone="danger"
        disabled={busy}
        onSelect={() => {
          actions.removeService(service.id);
        }}
      >
        {t('panel.remove')}
      </MenuItem>
    </RowMenu>
  );
}
