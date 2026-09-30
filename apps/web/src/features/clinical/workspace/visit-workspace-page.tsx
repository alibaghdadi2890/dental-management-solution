import { effectiveDentition, type Session, type Visit } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CardSkeleton } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/list';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { patientQuery } from '@/features/patients/patients-api';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useChartSettings, useToothLabel, useToothName } from '../chart/use-chart-settings';
import { SaveGroupsProvider } from '../save-groups-provider';
import { useVisit } from '../use-visit';
import { chartQuery } from '../visits-api';
import { ChartCard, ChartCardFrame } from './chart-card';
import type { ResolvedDentition } from './dentition-select';
import {
  ToothSelectionContext,
  useToothSelection,
  useToothSelectionState,
} from './tooth-selection';
import { useChartKeyboard } from './use-chart-keyboard';
import { VisitHeader } from './visit-header';

type Tenant = NonNullable<Session['tenant']>;

/** No presence records yet (the chart is loading): one stable array, so the keyboard doesn't
 * resubscribe on every render. */
const NO_STATUS: never[] = [];

/** The `/visits/$visitId` route: one workspace per visit, so its autosave groups (V6) never
 * carry over from one visit to the next. */
export function VisitWorkspaceScreen({ visitId }: { visitId: string }) {
  return (
    <SaveGroupsProvider key={visitId}>
      <VisitWorkspacePage visitId={visitId} />
    </SaveGroupsProvider>
  );
}

/**
 * The visit workspace (spec §Screens 4 & 5): loads the live visit; an unknown or discarded id
 * (404) reads "Visit not found", any other failure offers Try again. A visit that is no longer
 * live — completed, or discarded from this page — goes to the patient's record.
 */
function VisitWorkspacePage({ visitId }: { visitId: string }) {
  const { t } = useTranslation(['clinical', 'common']);
  const { data: session } = useSession();
  const visit = useVisit(visitId);

  if (!session?.tenant) return null;
  if (!visit.data) {
    if (visit.error === null) {
      return (
        <div className="p-[22px]">
          <CardSkeleton label={t('workspace.loading')} />
        </div>
      );
    }
    const notFound = visit.error instanceof ApiError && visit.error.status === 404;
    return (
      <div className="h-full overflow-auto p-[22px]">
        <section className="rounded-xl border border-border bg-surface">
          {notFound ? (
            <EmptyState
              title={t('workspace.notFoundTitle')}
              body={t('workspace.notFoundBody')}
              action={
                <Link
                  to="/patients"
                  className="inline-flex h-9 items-center rounded-lg border border-border-control bg-surface px-3.5 text-[12.5px] leading-none font-medium text-ink hover:border-primary hover:text-primary"
                >
                  {t('workspace.toPatients')}
                </Link>
              }
            />
          ) : (
            <ErrorState
              title={t('workspace.failedTitle')}
              body={t('workspace.failedBody')}
              requestId={visit.error instanceof ApiError ? visit.error.requestId : undefined}
              onRetry={() => void visit.refetch()}
            />
          )}
        </section>
      </div>
    );
  }
  if (visit.data.status === 'completed' || visit.data.status === 'discarded') {
    return (
      <Navigate to="/patients/$patientId" params={{ patientId: visit.data.patientId }} replace />
    );
  }
  return <Workspace visit={visit.data} tenant={session.tenant} />;
}

/**
 * The three bands in a full-height column: the header; the body, a wrapping row of the left
 * region (`1 1 600px`: the chart card) and the selected-tooth aside (`1 1 340px`), so the aside
 * reflows under the chart below ~1000px; and the financial bar. Read-only without `visit:write`
 * (W18). The tooth selection lives here, shared with the chart and the aside.
 */
function Workspace({ visit, tenant }: { visit: Visit; tenant: Tenant }) {
  const { t } = useTranslation('clinical');
  const canWrite = usePermission('visit:write');
  const patient = useQuery(patientQuery(visit.patientId));
  const chart = useQuery(chartQuery(visit.patientId));
  const selection = useToothSelectionState();
  const { orientation } = useChartSettings();

  // The patient's own override answers at once after a change; the chart's age stays the
  // server's (the tenant's date), so the stage never waits for the chart refetch.
  const dentition: ResolvedDentition | undefined = chart.data && {
    ...(patient.data
      ? effectiveDentition(chart.data.dentition.ageYears, patient.data.dentitionOverride)
      : chart.data.dentition),
    ageYears: chart.data.dentition.ageYears,
  };

  useChartKeyboard({
    orientation,
    dentition: dentition?.stage ?? 'permanent',
    toothStatus: chart.data?.toothStatus ?? NO_STATUS,
    selected: selection.tooth,
    onSelect: selection.select,
  });

  return (
    <ToothSelectionContext.Provider value={selection}>
      <div className="flex h-full flex-col">
        <VisitHeader
          visit={visit}
          patient={patient.data}
          chart={chart.data}
          tenant={tenant}
          canWrite={canWrite}
        />
        <div className="flex min-h-0 flex-1 flex-wrap items-stretch overflow-auto">
          <div className="min-w-0 flex-[1_1_600px] px-5 pt-[18px] pb-5">
            {chart.data && patient.data && dentition ? (
              <ChartCard
                visit={visit}
                chart={chart.data}
                patient={patient.data}
                dentition={dentition}
                canWrite={canWrite}
              />
            ) : (
              <ChartCardFrame>
                {chart.error || patient.error ? (
                  <ErrorState
                    title={t('workspace.chartFailed')}
                    body={t('workspace.failedBody')}
                    onRetry={() => {
                      void chart.refetch();
                      void patient.refetch();
                    }}
                  />
                ) : (
                  <CardSkeleton label={t('workspace.loading')} />
                )}
              </ChartCardFrame>
            )}
          </div>
          <ToothAside />
        </div>
        <FinancialBand visit={visit} />
      </div>
    </ToothSelectionContext.Provider>
  );
}

/** The selected-tooth aside (`surface`, 1px inline-start border, 16px padding): names the
 * selected tooth; the tooth panel fills it. */
function ToothAside() {
  const { t } = useTranslation('clinical');
  const { tooth } = useToothSelection();
  const label = useToothLabel();
  const name = useToothName();
  return (
    <aside
      aria-label={t('workspace.toothPanel')}
      className="min-w-0 flex-[1_1_340px] border-s border-border bg-surface p-4"
    >
      <p className="m-0 text-[12.5px] leading-normal text-ink-muted">
        {tooth === null
          ? t('workspace.noTooth')
          : t('workspace.toothLine', { label: label(tooth), name: name(tooth) })}
      </p>
    </aside>
  );
}

/** The financial bar band (`surface`, 1px top border, upward shadow, 12px 22px): the service
 * count and the visit total from the visit's own money; the discount controls and actions fill
 * it. */
function FinancialBand({ visit }: { visit: Visit }) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  return (
    <footer
      aria-label={t('workspace.money')}
      className="flex flex-none flex-wrap items-center gap-x-[22px] gap-y-3.5 border-t border-border bg-surface px-[22px] py-3 shadow-[0_-4px_14px_rgba(27,26,31,.05)]"
    >
      <span className="flex-none text-[12.5px] leading-none whitespace-nowrap text-ink-muted">
        {t('workspace.services', { count: visit.services.length })}
      </span>
      <span className="ms-auto flex flex-none flex-col items-end gap-1">
        <span className="text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal">
          {t('workspace.total')}
        </span>
        <span
          dir="ltr"
          className="font-mono text-[21px] leading-none font-bold tracking-[-0.02em] tabular-nums"
        >
          {formatMoney({ amount: visit.money.total, currency: visit.currency }, locale)}
        </span>
      </span>
    </footer>
  );
}
