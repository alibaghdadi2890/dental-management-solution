import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';

export const Route = createFileRoute('/_app/catalog')({
  staticData: { navKey: 'catalog' },
  component: CatalogPage,
});

function CatalogPage() {
  const { t } = useTranslation('catalog');
  return <Page title={t('title')} subtitle={t('subtitle')} />;
}
