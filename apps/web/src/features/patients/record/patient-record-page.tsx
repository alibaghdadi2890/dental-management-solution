import type { Session } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardSkeleton } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/list';
import { TabPanel } from '@/components/ui/tabs';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { ApiError } from '@/lib/api';
import { patientQuery } from '../patients-api';
import { InformationTab } from './information-tab';
import { OverviewTab } from './overview-tab';
import { BackToPatients, RecordHeader } from './record-header';
import type { RecordTab } from './record-search';

type Tenant = NonNullable<Session['tenant']>;

interface RecordProps {
  patientId: string;
  tab: RecordTab;
}

/**
 * The `/patients/$patientId` route's wiring, shared with the tests so they drive exactly what
 * ships: a fresh record per patient id, and tab changes that replace the history entry — the
 * record is one entry however many tabs were visited, so Back (and "All patients") leaves it.
 */
export function PatientRecordScreen({ patientId, tab }: RecordProps) {
  const navigate = useNavigate();
  return (
    <PatientRecordPage
      key={patientId}
      patientId={patientId}
      tab={tab}
      onTab={(next) => {
        void navigate({
          to: '/patients/$patientId',
          params: { patientId },
          search: { tab: next },
          replace: true,
        });
      }}
    />
  );
}

/**
 * The patient record (workspace spec §Screen 3, design §Patient record): the header with its two
 * tabs, then Overview or Patient information. Loading shows skeleton bars inside the cards; an
 * unknown id (or another clinic's patient) reads "Patient not found" with a way back to the list;
 * any other failure offers Try again.
 */
function PatientRecordPage(props: RecordProps & { onTab: (tab: RecordTab) => void }) {
  const { data: session } = useSession();
  if (!session?.tenant) return null;
  return <PatientRecord {...props} tenant={session.tenant} />;
}

function PatientRecord({
  patientId,
  tab,
  onTab,
  tenant,
}: RecordProps & { onTab: (tab: RecordTab) => void; tenant: Tenant }) {
  const { t, i18n } = useTranslation(['patients', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const tabsId = useId();
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
        tabsId={tabsId}
        tab={tab}
        onTab={onTab}
      />
      <TabPanel idBase={tabsId} tabKey={tab} className="max-w-[1320px] px-[26px] pt-[22px] pb-11">
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
      </TabPanel>
    </div>
  );
}

/** The header's shape and the active tab's cards — the Balance card too, for those who will see
 * it — filled with skeleton bars, so nothing shifts when the record arrives. */
function RecordSkeleton({ tab }: { tab: RecordTab }) {
  const { t } = useTranslation(['patients', 'billing']);
  const canPay = usePermission('payment:read');
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
            <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
              {canPay && (
                <Card title={t('billing:balance.title')}>
                  <CardSkeleton label={label} />
                </Card>
              )}
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
