import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';

export const Route = createFileRoute('/_app/patients')({
  staticData: { navKey: 'patients' },
  component: PatientsPage,
});

function PatientsPage() {
  const { t } = useTranslation('patients');
  return <Page title={t('title')} subtitle={t('subtitle')} />;
}
