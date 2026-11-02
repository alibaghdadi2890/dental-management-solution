import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/toast-context';
import { apiErrorMessage } from '@/lib/api-error-message';
import { declineFollowUp, invalidateSchedule, markFollowUpWillCall } from './scheduling-api';

/** *Patient will call* and *Patient declined…*, for the checkout and the worklist. */
export function useFollowUpOutcomes() {
  const { t, i18n } = useTranslation('scheduling');
  const toast = useToast();
  const queryClient = useQueryClient();
  const settle = {
    onSuccess: () => invalidateSchedule(queryClient),
    onError: (error: unknown) => {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    },
  };
  const willCall = useMutation({
    mutationFn: (id: string) => markFollowUpWillCall(id),
    ...settle,
    onSuccess: () => {
      toast(t('toast.willCall'));
      return invalidateSchedule(queryClient);
    },
  });
  const decline = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => declineFollowUp(id, reason),
    ...settle,
    onSuccess: () => {
      toast(t('toast.declined'));
      return invalidateSchedule(queryClient);
    },
  });
  return { willCall, decline };
}
