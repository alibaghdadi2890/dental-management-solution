import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';

export function TenantDetailPage({ tenantId }: { tenantId: string; tab: string }) {
  const { t } = useTranslation('shell');
  return <Page title={t('nav.tenants')} subtitle={tenantId} />;
}
