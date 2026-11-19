import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast-context';
import { apiErrorMessage } from '@/lib/api-error-message';
import { invalidateInventory, undoMovement } from './inventory-api';
import { useInventoryWords } from './inventory-words';

/** The _Undo_ of a take-out's toast (D3): puts the movement back, then says so. */
export function useUndoTakeOut() {
  const { t, i18n } = useInventoryWords();
  const queryClient = useQueryClient();
  const toast = useToast();
  return (movementId: string | undefined) =>
    movementId === undefined
      ? {}
      : {
          actionLabel: t('takeOut.undo'),
          onAction: () => {
            void undoMovement(movementId)
              .then(() => invalidateInventory(queryClient))
              .then(() => {
                toast(t('takeOut.undone'), { tone: 'info' });
              })
              .catch((error: unknown) => {
                toast(apiErrorMessage(error, i18n), { tone: 'danger' });
              });
          },
        };
}
