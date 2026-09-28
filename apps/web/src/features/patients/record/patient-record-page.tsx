import type { Session } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardSkeleton } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/list';
import { useSession } from '@/features/auth/session';
import { ApiError } from '@/lib/api';
import { patientQuery } from '../patients-api';
import { InformationTab } from './information-tab';
import { OverviewTab } from './overview-tab';
import { BackToPatients, RecordHeader } from './record-header';
import type { RecordTab } from './record-search';

type Tenant = NonNullable<Session['tenant']>;

interface RecordPageProps {
  patientId: string;
  tab: RecordTab;
  onTab: (tab: RecordTab) => void;
}

/**
 * The patient record, `/patients/$patientId` (workspace spec §Screen 3, design §Patient record):
 * the header with its two tabs, then Overview or Patient information. Loading shows skeleton bars
 * inside the cards; an unknown id (or another clinic's patient) reads "Patient not found" with a
 * way back to the list; any other failure offers Try again.
 */
export function PatientRecordPage(props: RecordPageProps) {
  const { data: session } = useSession();
  if (!session?.tenant) return null;
  return <PatientRecord {...props} tenant={session.tenant} />;
}

function PatientRecord({ patientId, tab, onTab, tenant }: RecordPageProps & { tenant: Tenant }) {
  const { t, i18n } = useTranslation(['patients', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const patient = useQuery(patientQuery(patientId));

  if (!patient.data) {
    if (patient.error === null) return <RecordSkeleton tab={tab} />;
    const notFound = patient.error instanceof ApiError && patient.error.status === 404;
    return (
      <div className="h-full overflow-auto">
        <div className="max-w-[1320px] px-[26px] pt-5 pb-11">
          <BackToPatients />
          <section className="rounded-xl border border-border bg-surface">
            {notFound ? (
              <EmptyState
                title={t('panel.notFoundTitle')}
                body={t('panel.notFoundBody')}
                action={
                  <Link
                    to="/patients"
                    className="inline-flex h-9 items-center rounded-lg border border-border-control bg-surface px-3.5 text-[12.5px] leading-none font-medium text-ink hover:border-primary hover:text-primary"
                  >
                    {t('record.back')}
                  </Link>
                }
              />
            ) : (
              <ErrorState
                title={t('panel.failedTitle')}
                body={t('panel.failedBody')}
                requestId={patient.error instanceof ApiError ? patient.error.requestId : undefined}
                onRetry={() => void patient.refetch()}
              />
            )}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <RecordHeader
        patient={patient.data}
        tenant={tenant}
        locale={locale}
        tab={tab}
        onTab={onTab}
      />
      <div
        role="tabpanel"
        aria-label={t(`record.tabs.${tab}`)}
        className="max-w-[1320px] px-[26px] pt-[22px] pb-11"
      >
        {tab === 'overview' ? (
          <OverviewTab
            patient={patient.data}
            tenant={tenant}
            locale={locale}
            onComplete={() => {
              onTab('information');
            }}
          />
        ) : (
          <InformationTab patient={patient.data} tenant={tenant} />
        )}
      </div>
    </div>
  );
}

/** The header's shape and the active tab's cards, filled with skeleton bars. */
function RecordSkeleton({ tab }: { tab: RecordTab }) {
  const { t } = useTranslation('patients');
  const label = t('panel.loading');
  return (
    <div className="h-full overflow-auto">
      <div className="border-b border-border bg-surface px-[26px] pt-5 pb-[54px]">
        <BackToPatients />
        <div className="flex items-start gap-4">
          <span className="size-[52px] flex-none rounded-[10px] bg-inner-divider" />
          <div className="flex w-64 flex-col gap-2.5 pt-1">
            <span className="block h-[18px] w-[72%] rounded-[4px] bg-inner-divider" />
            <span className="block h-[11px] w-[60%] rounded-[4px] bg-row-divider" />
          </div>
        </div>
      </div>
      <div className="max-w-[1320px] px-[26px] pt-[22px] pb-11">
        {tab === 'overview' ? (
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-[1_1_520px]">
              <Card title={t('record.info.title')}>
                <CardSkeleton label={label} />
              </Card>
            </div>
            <div className="min-w-0 flex-[1_1_300px]">
              <Card title={t('record.summary.title')}>
                <CardSkeleton label={label} />
              </Card>
            </div>
          </div>
        ) : (
          <Card title={t('record.form.title')} className="max-w-[760px] px-[22px] py-5">
            <CardSkeleton label={label} />
          </Card>
        )}
      </div>
    </div>
  );
}
