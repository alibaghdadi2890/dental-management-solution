import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { SettingsPage } from '@/features/tenancy/settings-page';
import { SETTINGS_TABS } from '@/features/tenancy/settings-tabs';

export const Route = createFileRoute('/_app/settings')({
  staticData: { navKey: 'settings' },
  validateSearch: z.object({ tab: z.enum(SETTINGS_TABS).optional() }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const { tab } = Route.useSearch();
  return <SettingsPage tab={tab} />;
}
