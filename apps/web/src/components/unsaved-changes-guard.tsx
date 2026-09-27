import { useBlocker } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from './ui/confirm-dialog';

/**
 * POC unsaved-changes guard: while `when` holds, leaving the screen asks "Discard unsaved
 * changes?" and closing the tab asks the browser's question. Changing only the search (tabs,
 * filters) of the same screen is not leaving it.
 */
export function UnsavedChangesGuard({ when }: { when: boolean }) {
  const { t } = useTranslation('common');
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => when && current.pathname !== next.pathname,
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
