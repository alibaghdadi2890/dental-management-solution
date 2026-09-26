import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { stopActing } from '@/features/platform/acting-tenant';

/** Full-width amber banner while a platform admin manages a clinic (ADR-0008). */
export function ActingTenantBanner({
  tenantId,
  tenantName,
}: {
  tenantId: string;
  tenantName: string;
}) {
  const { t } = useTranslation('shell');
  const queryClient = useQueryClient();
  return (
    <div
      role="status"
      className="flex flex-none items-center gap-3 border-b border-warning-border bg-warning-bg px-[22px] py-2 text-[12.5px] leading-snug text-warning"
    >
      <span className="size-2 flex-none rounded-full bg-warning-dot" />
      <span className="min-w-0 flex-1 font-medium">
        {t('acting.banner', { tenant: tenantName })}
      </span>
      <Link
        to="/admin/tenants/$tenantId"
        params={{ tenantId }}
        onClick={() => {
          stopActing();
          queryClient.removeQueries({ queryKey: ['session'] });
        }}
        className="font-semibold text-warning underline-offset-2 hover:underline"
      >
        {t('acting.exit')}
      </Link>
    </div>
  );
}
