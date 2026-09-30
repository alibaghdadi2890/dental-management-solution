import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';

export const Route = createFileRoute('/_app/visits/')({
  staticData: { navKey: 'visits' },
  component: VisitsPage,
});

function VisitsPage() {
  const { t } = useTranslation('visits');
  return <Page title={t('title')} subtitle={t('subtitle')} />;
}
