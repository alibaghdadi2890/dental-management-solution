import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';

export function TenantsPage() {
  const { t } = useTranslation('shell');
  return <Page title={t('nav.tenants')} subtitle={t('clinic.platformSubtitle')} />;
}
