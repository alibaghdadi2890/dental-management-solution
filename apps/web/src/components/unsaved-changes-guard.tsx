import { useBlocker } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from './ui/confirm-dialog';

/** The parts of a location the guard compares (the router's own parsed search). */
export interface GuardLocation {
  pathname: string;
  search: unknown;
}

const otherScreen = (current: GuardLocation, next: GuardLocation) =>
  current.pathname !== next.pathname;

/**
 * POC unsaved-changes guard: while `when` holds, leaving the screen asks "Discard unsaved
 * changes?" and closing the tab asks the browser's question. By default changing only the search
 * (tabs, filters) of the same screen is not leaving it; `isLeaving` narrows or widens that (a
 * right panel held in the URL search is left when its search param changes).
 */
export function UnsavedChangesGuard({
  when,
  isLeaving = otherScreen,
}: {
  when: boolean;
  isLeaving?: (current: GuardLocation, next: GuardLocation) => boolean;
}) {
  const { t } = useTranslation('common');
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => when && isLeaving(current, next),
    enableBeforeUnload: when,
    withResolver: true,
  });

  if (blocker.status !== 'blocked') return null;
  return (
    <ConfirmDialog
      options={{
        title: t('discardTitle'),
        body: t('discardBody'),
        okLabel: t('discardLeave'),
        cancelLabel: t('keepEditing'),
        tone: 'warn',
        onConfirm: () => {
          blocker.proceed();
        },
      }}
      onClose={() => {
        blocker.reset();
      }}
    />
  );
}
