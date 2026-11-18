import { idSchema, isoDateSchema } from '@dcm/contracts';
import { createFileRoute, type SearchSchemaInput } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Page } from '@/components/page';
import { EmptyState } from '@/components/ui/list';
import { useSession } from '@/features/auth/session';
import { LabDetailPage } from '@/features/labs/lab-detail-page';
import { LAB_DETAIL_TABS, type LabDetailSearch } from '@/features/labs/lab-search';

const searchSchema = z.object({
  tab: z.enum(LAB_DETAIL_TABS).optional().catch(undefined),
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
  order: idSchema.optional().catch(undefined),
});

/** One lab's page (feature 18): the URL keeps the tab, the statement's period and an open order. */
export const Route = createFileRoute('/_app/labs/$labId')({
  staticData: { navKey: 'lab' },
  validateSearch: (search: Record<string, unknown> & SearchSchemaInput): LabDetailSearch => {
    const parsed = searchSchema.parse(search);
    // A period is whole or not at all.
    return parsed.from && parsed.to && parsed.from <= parsed.to
      ? parsed
      : { ...parsed, from: undefined, to: undefined };
  },
  component: LabDetailRoute,
});

function LabDetailRoute() {
  const { t } = useTranslation('labs');
  const { labId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: session } = useSession();
  if (!session?.tenant) return null;
  if (!session.permissions.includes('lab:read')) {
    return (
      <Page title={t('title')} subtitle={t('subtitle')}>
        <EmptyState title={t('noAccess.title')} body={t('noAccess.body')} />
      </Page>
    );
  }
  return (
    <LabDetailPage
      labId={labId}
      session={session}
      search={search}
      onSearch={(next) => {
        void navigate({ search: next, replace: true });
      }}
    />
  );
}
