import { type HistoryLocation, type HistoryState, useRouter } from '@tanstack/react-router';
import { useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from './ui/confirm-dialog';

/** The parts of a location the guard compares: the pathname, the router's own parsed search, and
 * the history state (which can hold what a panel was opened with, e.g. the create pre-fill). */
export interface GuardLocation {
  pathname: string;
  search: unknown;
  state: HistoryState;
}

const otherScreen = (current: GuardLocation, next: GuardLocation) =>
  current.pathname !== next.pathname;

interface Blocked {
  proceed: () => void;
  reset: () => void;
}

/**
 * POC unsaved-changes guard: while `when` holds, leaving the screen asks "Discard unsaved
 * changes?" and closing the tab asks the browser's question. By default changing only the search
 * (tabs, filters) of the same screen is not leaving it; `isLeaving` narrows or widens that (a
 * right panel held in the URL search is left when its search param changes).
 *
 * It blocks on the router's history directly rather than through `useBlocker`, whose locations
 * leave out the history state that `isLeaving` may need to compare.
 */
export function UnsavedChangesGuard({
  when,
  isLeaving = otherScreen,
}: {
  when: boolean;
  isLeaving?: (current: GuardLocation, next: GuardLocation) => boolean;
}) {
  const { t } = useTranslation('common');
  const router = useRouter();
  const [blocked, setBlocked] = useState<Blocked | null>(null);

  const shouldBlock = useEffectEvent((current: HistoryLocation, next: HistoryLocation) => {
    const guarded = ({ pathname, search, state }: HistoryLocation): GuardLocation => ({
      pathname,
      search: router.options.parseSearch(search),
      state,
    });
    return isLeaving(guarded(current), guarded(next));
  });

  useEffect(() => {
    if (!when) return;
    return router.history.block({
      enableBeforeUnload: true,
      blockerFn: async ({ currentLocation, nextLocation }) => {
        if (!shouldBlock(currentLocation, nextLocation)) return false;
        const stay = await new Promise<boolean>((resolve) => {
          setBlocked({
            proceed: () => {
              resolve(false);
            },
            reset: () => {
              resolve(true);
            },
          });
        });
        setBlocked(null);
        return stay;
      },
    });
  }, [when, router]);

  if (!blocked) return null;
  return (
    <ConfirmDialog
      options={{
        title: t('discardTitle'),
        body: t('discardBody'),
        okLabel: t('discardLeave'),
        cancelLabel: t('keepEditing'),
        tone: 'warn',
        onConfirm: () => {
          blocked.proceed();
        },
      }}
      onClose={() => {
        blocked.reset();
      }}
    />
  );
}
