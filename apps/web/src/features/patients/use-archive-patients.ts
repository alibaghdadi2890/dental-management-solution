import type { PatientListItem } from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/ui/confirm-context';
import { useToast } from '@/components/ui/toast-context';
import { ApiError } from '@/lib/api';
import { archivePatients, invalidatePatientData, restorePatients } from './patients-api';

type Target = Pick<PatientListItem, 'id' | 'fullName'>;

/**
 * Archive (confirm with an optional reason, design Q11) and restore (no confirm) for the row menu
 * and the bulk bar. Each success toasts with **Undo**, which runs the opposite action once — the
 * undo's own toast has no further Undo.
 */
export function useArchivePatients({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation(['patients', 'common']);
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();

  const reasonOf = (error: unknown) =>
    error instanceof ApiError ? error.problem.title : t('common:unexpected');

  const doneText = (key: 'archive' | 'restore', targets: readonly Target[]) => {
    const [only] = targets;
    return targets.length === 1 && only
      ? t(`${key}.doneNamed`, { name: only.fullName })
      : t(`${key}.done`, { count: targets.length });
  };

  const run = async (
    action: 'archive' | 'restore',
    targets: readonly Target[],
    { reason, undoable }: { reason?: string; undoable: boolean },
  ) => {
    const ids = targets.map((target) => target.id);
    try {
      if (action === 'archive') {
        await archivePatients({ ids, reason: reason || null });
      } else {
        await restorePatients({ ids });
      }
    } catch (error) {
      toast(t(`${action}.failed`, { reason: reasonOf(error) }), { tone: 'danger' });
      return;
    }
    onDone();
    void invalidatePatientData(queryClient);
    const opposite = action === 'archive' ? 'restore' : 'archive';
    toast(
      doneText(action, targets),
      undoable
        ? {
            actionLabel: t('undo'),
            onAction: () => {
              void run(opposite, targets, { undoable: false });
            },
          }
        : {},
    );
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
      tone: 'warn',
      reasonLabel: t('archive.reason'),
      reasonOptional: true,
      onConfirm: (reason) => run('archive', targets, { reason, undoable: true }),
    });
  };

  const restore = (targets: readonly Target[]) => {
    void run('restore', targets, { undoable: true });
  };

  return { archive, restore };
}
