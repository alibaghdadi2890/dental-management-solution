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
import { useContactDrafts } from '../contact-drafts';
import { patientQuery } from '../patients-api';
import { useContactActions } from '../use-contact-actions';
import { InformationTab } from './information-tab';
import { OverviewTab } from './overview-tab';
import { BackToPatients, RecordHeader } from './record-header';
import { AddContactPanel } from './add-contact-panel';
import type { RecordPanel, RecordTab } from './record-search';

type Tenant = NonNullable<Session['tenant']>;

interface RecordProps {
  patientId: string;
  tab: RecordTab;
  /** The open right panel (`?panel=`), if any. */
  panel: RecordPanel | undefined;
}

interface RecordNavigation {
  onTab: (tab: RecordTab) => void;
  onPanel: (panel: RecordPanel | undefined) => void;
}

/**
 * The `/patients/$patientId` route's wiring, shared with the tests so they drive exactly what
 * ships: a fresh record per patient id, and tab and panel changes that replace the history entry
 * — the record is one entry however many tabs or panels were opened, so Back (and "All patients")
 * leaves it. Switching tabs closes a panel.
 */
export function PatientRecordScreen({ patientId, tab, panel }: RecordProps) {
  const navigate = useNavigate();
  const go = (search: { tab: RecordTab; panel?: RecordPanel | undefined }) => {
    void navigate({ to: '/patients/$patientId', params: { patientId }, search, replace: true });
  };
  return (
    <PatientRecordPage
      key={patientId}
      patientId={patientId}
      tab={tab}
      panel={panel}
      onTab={(next) => {
        go({ tab: next });
      }}
      onPanel={(next) => {
        go({ tab, panel: next });
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
function PatientRecordPage(props: RecordProps & RecordNavigation) {
  const { data: session } = useSession();
  if (!session?.tenant) return null;
  return <PatientRecord {...props} tenant={session.tenant} />;
}

function PatientRecord({
  patientId,
  tab,
  panel,
  onTab,
  onPanel,
  tenant,
}: RecordProps & RecordNavigation & { tenant: Tenant }) {
  const { t, i18n } = useTranslation(['patients', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const tabsId = useId();
  const patient = useQuery(patientQuery(patientId));
  const canWrite = usePermission('patient:write');
  // One set of contact actions for the Contacts & family card and the Add contact panel, so one
  // runs at a time; the panel's unsaved work, for the Patient information tab's guard.
  const contactActions = useContactActions(patientId);
  const panelDrafts = useContactDrafts();
  const closePanel = () => {
    onPanel(undefined);
  };

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

  // Adding a contact happens on Patient information, with `patient:write`, on a live record:
  // otherwise `?panel=` opens nothing (and switching tabs drops it).
  const addingContact =
    panel === 'add-contact' &&
    tab === 'information' &&
    canWrite &&
    patient.data.archivedAt === null;

  return (
    <div className="flex h-full min-h-0">
      <div className="h-full min-w-0 flex-1 overflow-auto">
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
            <InformationTab
              patient={patient.data}
              tenant={tenant}
              contactActions={contactActions}
              panelDirty={addingContact && panelDrafts.dirty}
              onAddContact={() => {
                onPanel('add-contact');
              }}
            />
          )}
        </TabPanel>
      </div>
      {addingContact && (
        <AddContactPanel
          patient={patient.data}
          tenant={tenant}
          actions={contactActions}
          drafts={panelDrafts}
          onClose={closePanel}
        />
      )}
    </div>
  );
}

/** The header's shape and the active tab's cards — the Balance card too, for those who will see
 * it — filled with skeleton bars, so nothing shifts when the record arrives. */
function RecordSkeleton({ tab }: { tab: RecordTab }) {
  const { t } = useTranslation(['patients', 'billing']);
  const canPay = usePermission('payment:read');
  const canVisits = usePermission('visit:read');
  const label = t('panel.loading');
  // The Overview's own arrangement (`OverviewTab`), so nothing moves once the record is in.
  const skeleton = (title: string) => (
    <Card title={title}>
      <CardSkeleton label={label} />
    </Card>
  );
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
            <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-4">
              {canVisits ? (
                <>
                  {skeleton(t('record.lastVisit.title'))}
                  {skeleton(t('record.dental.title'))}
                </>
              ) : (
                skeleton(t('record.info.title'))
              )}
            </div>
            <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
              {canPay && skeleton(t('billing:balance.title'))}
              {canVisits && (
                <>
                  {skeleton(t('record.summary.title'))}
                  {skeleton(t('record.info.title'))}
                </>
              )}
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
