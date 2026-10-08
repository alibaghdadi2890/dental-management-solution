import {
  canArchiveFile,
  canRestoreFile,
  type FileActor,
  type PatientFile,
  type Permission,
} from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/ui/confirm-context';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { apiErrorMessage } from '@/lib/api-error-message';
import { applyFiles, archiveFiles, invalidateFiles, restoreFiles } from './files-api';

/**
 * Archive and Restore (feature 8, F10, F13), the same from the viewer, a tile's menu and the bulk
 * bar: a confirm with an optional reason, then a toast "Archived" whose one action is **Undo**.
 * `canArchive` / `canRestore` are the API's own rule (`@dcm/contracts`), so the action is only
 * offered to who may take it: `file:archive`, or the uploader within 24 hours.
 */
export function useArchiveFiles() {
  const { t, i18n } = useTranslation('files');
  const { data: session } = useSession();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();

  const actor = useMemo<FileActor | null>(() => {
    if (!session) return null;
    const granted = new Set<Permission>(session.permissions);
    return { userId: session.user.id, can: (permission) => granted.has(permission) };
  }, [session]);

  const restore = useCallback(
    async (files: readonly PatientFile[]) => {
      const [first] = files;
      if (!first) return;
      try {
        applyFiles(queryClient, await restoreFiles(files.map((file) => file.id)));
        void invalidateFiles(queryClient, first.patientId);
        toast(t('archive.restored', { count: files.length }), { tone: 'success' });
      } catch (error) {
        toast(apiErrorMessage(error, i18n), { tone: 'danger' });
      }
    },
    [queryClient, toast, t, i18n],
  );

  const archive = useCallback(
    (files: readonly PatientFile[], onDone?: () => void) => {
      const [first] = files;
      if (!first) return;
      confirm({
        title: t('archive.title', { count: files.length }),
        body: t('archive.body'),
        okLabel: t('archive.ok'),
        reasonLabel: t('archive.reason'),
        reasonOptional: true,
        tone: 'warn',
        onConfirm: async (reason) => {
          let archived;
          try {
            archived = await archiveFiles({
              ids: files.map((file) => file.id),
              reason: reason === '' ? undefined : reason,
            });
          } catch (error) {
            // The dialog shows the message and stays open.
            throw new Error(apiErrorMessage(error, i18n), { cause: error });
          }
          applyFiles(queryClient, archived);
          void invalidateFiles(queryClient, first.patientId);
          onDone?.();
          toast(t('archive.done', { count: files.length }), {
            tone: 'success',
            actionLabel: t('archive.undo'),
            onAction: () => void restore(archived.items),
          });
        },
      });
    },
    [confirm, queryClient, toast, restore, t, i18n],
  );

  return {
    archive,
    restore,
    canArchive: useCallback(
      (file: PatientFile) =>
        actor !== null && file.archivedAt === null && canArchiveFile(actor, file, new Date()),
      [actor],
    ),
    canRestore: useCallback(
      (file: PatientFile) =>
        actor !== null && file.archivedAt !== null && canRestoreFile(actor, file),
      [actor],
    ),
  };
}
