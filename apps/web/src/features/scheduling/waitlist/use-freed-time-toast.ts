import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/toast-context';
import { fetchOpening } from './waitlist-api';
import { useWaitlistPanels } from './waitlist-context';

/**
 * The toast of a cancel or a move (C2): when someone fits the time it freed, it adds
 * *n on the waitlist fit* with *Fill*. Only for whoever may fill (`appointment:write_all`).
 */
export function useFreedTimeToast(): (freedId: string, message: string) => Promise<void> {
  const { t } = useTranslation('scheduling');
  const toast = useToast();
  const { openFill } = useWaitlistPanels();
  return async (freedId, message) => {
    if (!openFill) {
      toast(message);
      return;
    }
    const detail = await fetchOpening(freedId).catch(() => null);
    const count = detail?.fits.length ?? 0;
    if (!detail?.opening || count === 0) {
      toast(message);
      return;
    }
    const at = detail.opening.startsAt;
    toast(message, {
      body: t('waitlist.fitToast', { count }),
      actionLabel: t('waitlist.fill'),
      onAction: () => {
        openFill(freedId, at);
      },
    });
  };
}
