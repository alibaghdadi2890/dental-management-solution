import { formatReceiptNumber, type Transaction } from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/ui/confirm-context';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { invalidateVisitData } from '@/features/clinical/visits-list/visits-list-api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatMoney } from '@/lib/format';
import { releaseHold } from '../payments-api';

type HeldPayment = Pick<Transaction, 'id' | 'receiptNumber' | 'heldUnspent' | 'currency'>;

/**
 * "Release to credit" on a payment held for the treatment plan (ADR-0051): a confirm with a
 * required reason; what the payment still holds becomes credit at once. Null without
 * `payment:write`.
 */
export function useReleaseHold(locale: string): ((payment: HeldPayment) => void) | null {
  const { t, i18n } = useTranslation('billing');
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canRelease = usePermission('payment:write');
  if (!canRelease) return null;
  return (payment) => {
    const amount = formatMoney({ amount: payment.heldUnspent, currency: payment.currency }, locale);
    confirm({
      title: t('release.title', { receipt: formatReceiptNumber(payment.receiptNumber) }),
      body: t('release.body', { amount }),
      okLabel: t('release.ok'),
      reasonLabel: t('release.reason'),
      onConfirm: async (reason) => {
        try {
          await releaseHold(payment.id, { reason });
        } catch (error) {
          throw new Error(apiErrorMessage(error, i18n), { cause: error });
        }
        await invalidateVisitData(queryClient);
        toast(t('release.done', { amount }), { tone: 'success' });
      },
    });
  };
}
