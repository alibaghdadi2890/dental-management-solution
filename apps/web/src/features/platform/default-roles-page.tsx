import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { PanelLayout } from '@/components/ui/panel-slot';
import { platformRoleTemplates } from '@/features/roles/roles-source';
import { RolesTab } from '@/features/roles/roles-tab';

const SOURCE = platformRoleTemplates();

/**
 * The platform's default roles (ADR-0056), for clinics that would rather not manage access
 * themselves: what every new clinic is created with, and what a clinic's Reset to default
 * restores. Existing clinics never change with them.
 */
export function DefaultRolesPage() {
  const { t } = useTranslation('roles');
  return (
    <PanelLayout>
      <Page title={t('defaults.title')} subtitle={t('defaults.subtitle')}>
        <RolesTab source={SOURCE} />
      </Page>
    </PanelLayout>
  );
}
