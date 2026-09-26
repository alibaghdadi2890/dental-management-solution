import type { Tenant, TenantStatus } from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/ui/confirm-context';
import { useToast } from '@/components/ui/toast-context';
import { platformKeys, setTenantStatus } from './platform-api';

/** Suspend / reactivate behind the POC confirm dialog; the reason goes to the audit trail. */
export function useTenantStatusAction(): (
  tenant: Pick<Tenant, 'id' | 'name'>,
  status: TenantStatus,
) => void {
  const { t } = useTranslation('admin');
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();

  return useCallback(
    (tenant, status) => {
      const suspending = status === 'suspended';
      confirm({
        title: t(suspending ? 'status.suspendTitle' : 'status.reactivateTitle', {
          name: tenant.name,
        }),
        body: t(suspending ? 'status.suspendBody' : 'status.reactivateBody'),
        okLabel: t(suspending ? 'status.suspendOk' : 'status.reactivateOk'),
        tone: suspending ? 'danger' : 'warn',
        reasonLabel: t('status.reason'),
        onConfirm: async (reason) => {
          try {
            await setTenantStatus(tenant.id, status, reason);
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: platformKeys.tenants }),
              queryClient.invalidateQueries({ queryKey: platformKeys.tenant(tenant.id) }),
            ]);
            toast(t(suspending ? 'status.suspended' : 'status.reactivated', { name: tenant.name }));
          } catch {
            toast(t('status.failed'), { tone: 'danger' });
          }
        },
      });
    },
    [confirm, queryClient, t, toast],
  );
}
