import type { PatientListItem } from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/ui/confirm-context';
import { useToast } from '@/components/ui/toast-context';
import { FAILURE_VALUES, failureOf } from './panels/form-server-errors';
import { archivePatients, invalidatePatientData, restorePatients } from './patients-api';

type Target = Pick<PatientListItem, 'id' | 'fullName'>;
type Action = 'archive' | 'restore';

/**
 * Archive (confirm with an optional reason, design Q11) and restore (no confirm) for the row menu
 * and the bulk bar.
 *
 * - Success calls `onDone` (clear the selection) and `focusAfter` (the archived rows are gone,
 *   so focus moves to the table), then toasts with **Undo**, which runs the opposite action once:
 *   the Undo touches neither the selection nor focus, and its own toast has no further Undo.
 * - An archive that fails keeps its dialog open with the error inline (the reason is kept); a
 *   restore that fails, having no dialog, toasts the error. Either reads a localized reason
 *   (`failureOf`), not the server's problem title.
 * - `busy` is true while either runs, so callers can disable their buttons.
 */
export function useArchivePatients({
  onDone,
  focusAfter,
}: {
  onDone: () => void;
  focusAfter: () => void;
}) {
  const { t } = useTranslation('patients');
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(0);

  // The reason in the person's language, never the server's English problem title.
  const failure = (action: Action, error: unknown) =>
    t(`${action}.failed`, { reason: t(`failures.${failureOf(error)}`, FAILURE_VALUES) });

  const doneText = (action: Action, targets: readonly Target[]) => {
    const [only] = targets;
    return targets.length === 1 && only
      ? t(`${action}.doneNamed`, { name: only.fullName })
      : t(`${action}.done`, { count: targets.length });
  };

  const send = async (action: Action, targets: readonly Target[], reason?: string) => {
    const ids = targets.map((target) => target.id);
    setRunning((count) => count + 1);
    try {
      if (action === 'archive') {
        await archivePatients({ ids, reason: reason || null });
      } else {
        await restorePatients({ ids });
      }
    } finally {
      setRunning((count) => count - 1);
    }
    void invalidatePatientData(queryClient);
  };

  const undo = (action: Action, targets: readonly Target[]) => {
    send(action, targets).then(
      () => {
        toast(doneText(action, targets));
      },
      (error: unknown) => {
        toast(failure(action, error), { tone: 'danger' });
      },
    );
  };

  const succeeded = (action: Action, targets: readonly Target[]) => {
    onDone();
    toast(doneText(action, targets), {
      actionLabel: t('undo'),
      onAction: () => {
        undo(action === 'archive' ? 'restore' : 'archive', targets);
      },
    });
  };

  const archive = (targets: readonly Target[]) => {
    const [only] = targets;
    confirm({
      title:
        targets.length === 1 && only
          ? t('archive.titleNamed', { name: only.fullName })
          : t('archive.title', { count: targets.length }),
      body: t('archive.body'),
      okLabel: t('archive.ok'),
      tone: 'danger',
      reasonLabel: t('archive.reason'),
      reasonOptional: true,
      focusAfterConfirm: focusAfter,
      onConfirm: async (reason) => {
        try {
          await send('archive', targets, reason);
        } catch (error) {
          throw new Error(failure('archive', error), { cause: error });
        }
        succeeded('archive', targets);
      },
    });
  };

  const restore = (targets: readonly Target[]) => {
    send('restore', targets).then(
      () => {
        succeeded('restore', targets);
        focusAfter();
      },
      (error: unknown) => {
        toast(failure('restore', error), { tone: 'danger' });
      },
    );
  };

  return { archive, restore, busy: running > 0 };
}
