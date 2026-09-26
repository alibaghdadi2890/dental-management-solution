import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';

export const Route = createFileRoute('/settings')({
  staticData: { navKey: 'settings' },
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation('settings');
  return <Page title={t('title')} subtitle={t('subtitle')} />;
}
