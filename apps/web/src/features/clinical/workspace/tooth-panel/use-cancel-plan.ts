import type { TreatmentPlan } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/ui/confirm-context';
import { useToast } from '@/components/ui/toast-context';
import { useChartingActions } from '../charting-actions';

/** Cancelling an open plan, or abandoning an unfinished service: asks first, then says so. */
export function useCancelPlan(): (plan: TreatmentPlan) => void {
  const { t } = useTranslation('clinical');
  const confirm = useConfirm();
  const toast = useToast();
  const actions = useChartingActions();
  return (plan) => {
    confirm({
      title: t('panel.plan.cancelTitle', { name: plan.name }),
      body: t('panel.plan.cancelBody'),
      okLabel: t('panel.plan.cancelOk'),
      cancelLabel: t('panel.plan.keep'),
      tone: 'warn',
      onConfirm: () => {
        actions.cancelPlan(plan.id);
        toast(t('panel.plan.cancelled', { name: plan.name }), { tone: 'success' });
      },
    });
  };
}
