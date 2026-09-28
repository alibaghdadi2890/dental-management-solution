import type { Patient, Session } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SHIMMER } from '@/components/ui/list';
import { RightPanel } from '@/components/ui/right-panel';
import { usePermission } from '@/features/auth/use-permission';
import { balanceQuery } from '@/features/billing/billing-api';
import { owedBalances } from '@/features/billing/owed-balances';
import { useStaffNames } from '@/features/users/use-staff-names';
import { formatAgeLine, formatCalendarDate, formatMoney, formatPhone, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ActivityTimeline } from '../activity-timeline';
import type { PatientPanel } from '../list-query';
import { usePatientNavigation } from '../patient-navigation';
import { patientQuery } from '../patients-api';
import { PatientAvatar } from '../patients-table';
import { PanelFallback } from './panel-fallback';

type Tenant = NonNullable<Session['tenant']>;

const NONE = '—';

/**
 * Quick view (`Patients.dc.html` "view" panel, design §Right panel): who the patient is, their
 * alerts, the open balance (`payment:read`) and the activity timeline (`audit:read` only, Q10).
 * The footer opens the full record, and offers Edit details (`patient:write`, not archived).
 */
export function QuickViewPanel({
  id,
  tenant,
  onClose,
  onOpen,
}: {
  id: string;
  tenant: Tenant;
  onClose: () => void;
  onOpen: (panel: PatientPanel) => void;
}) {
  const { t } = useTranslation('patients');
  const patient = useQuery(patientQuery(id));
  if (!patient.data) {
    return (
      <PanelFallback
        eyebrow={t('quickView.eyebrow')}
        error={patient.error}
        onRetry={() => void patient.refetch()}
        onClose={onClose}
      />
    );
  }
  return <QuickView patient={patient.data} tenant={tenant} onClose={onClose} onOpen={onOpen} />;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[12.5px] leading-[1.4] text-ink-muted">{label}</dt>
      <dd className="m-0 text-[12.5px] leading-[1.4] font-medium [overflow-wrap:anywhere]">
        {children}
      </dd>
    </>
  );
}

/** Every non-zero balance, the tenant currency first (design Q13); "—" when there is none. */
function OpenBalance({ id, tenant, locale }: { id: string; tenant: Tenant; locale: string }) {
  const { t } = useTranslation('billing');
  const balance = useQuery(balanceQuery(id));
  if (balance.isPending) {
    return <span aria-busy="true" className={cn('inline-block h-2.5 w-14', SHIMMER)} />;
  }
  if (balance.isError) {
    return <span className="font-normal text-ink-muted">{t('balanceFailed')}</span>;
  }
  const owed = owedBalances(balance.data.balances, tenant.currency);
  if (owed.length === 0) {
    return <span className="font-mono font-normal text-ink-muted">{NONE}</span>;
  }
  return (
    <span className="flex flex-wrap gap-x-2.5">
      {owed.map((money) => (
        <span
          key={money.currency}
          className={cn(
            'font-mono tabular-nums',
            Number(money.amount) > 0 ? 'font-semibold text-danger' : 'font-normal text-ink-muted',
          )}
        >
          {formatMoney(money, locale)}
        </span>
      ))}
    </span>
  );
}

function QuickView({
  patient,
  tenant,
  onClose,
  onOpen,
}: {
  patient: Patient;
  tenant: Tenant;
  onClose: () => void;
  onOpen: (panel: PatientPanel) => void;
}) {
  const { t, i18n } = useTranslation(['patients', 'billing']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const canWrite = usePermission('patient:write');
  const canPay = usePermission('payment:read');
  const canAudit = usePermission('audit:read');
  const { names } = useStaffNames();
  const { openPatient } = usePatientNavigation();
  const archived = patient.archivedAt !== null;

  const ageLine = formatAgeLine(patient.dateOfBirth, todayIn(tenant.timeZone), { locale });
  const summary = [
    ageLine.kind === 'full'
      ? t('ageYears', { count: ageLine.age })
      : ageLine.kind === 'unknown'
        ? t('quickView.ageUnknown')
        : null,
    patient.sex === 'unknown' ? null : t(`quickView.sex.${patient.sex}`),
  ].filter((part) => part !== null);
  const dentist = patient.primaryDentistUserId
    ? (names.get(patient.primaryDentistUserId) ?? t('quickView.unknownDentist'))
    : NONE;

  return (
    <RightPanel
      eyebrow={t('quickView.eyebrow')}
      title={patient.fullName}
      dirty={false}
      onClose={onClose}
      footer={
        <>
          {canWrite && !archived && (
            <Button
              className="me-auto"
              onClick={() => {
                onOpen({ kind: 'edit', id: patient.id });
              }}
            >
              {t('quickView.edit')}
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => {
              openPatient(patient.id);
            }}
          >
            {t('quickView.openRecord')}
          </Button>
        </>
      }
    >
      <div className="mb-1 flex items-center gap-3">
        <PatientAvatar name={patient.fullName} large />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] leading-[1.3] font-semibold">{patient.fullName}</div>
          <div className="font-mono text-xs leading-[1.4] text-ink-muted">
            <span dir="ltr">{patient.displayNumber}</span>
            {summary.map((part) => (
              <span key={part}>{` · ${part}`}</span>
            ))}
          </div>
        </div>
        {archived && (
          <span className="h-[18px] flex-none rounded-[4px] border border-border bg-subtle px-1.5 text-[11.5px] leading-4 font-medium text-ink-secondary">
            {t('quickView.archived')}
          </span>
        )}
      </div>

      {patient.mergedIntoId !== null && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-faint px-3 py-2.5 text-[12.5px] leading-[1.45] text-ink-secondary">
          <span className="min-w-0 flex-1">{t('quickView.merged')}</span>
          <Button
            variant="ghost"
            size="sm"
            className="px-0"
            onClick={() => {
              if (patient.mergedIntoId) onOpen({ kind: 'quick', id: patient.mergedIntoId });
            }}
          >
            {t('quickView.openMerged')}
          </Button>
        </div>
      )}

      {patient.medicalAlerts.length > 0 && (
        <ul
          aria-label={t('quickView.alerts')}
          className="m-0 flex list-none flex-wrap gap-1.5 rounded-lg border border-danger-border bg-danger-bg p-2.5"
        >
          {patient.medicalAlerts.map((alert) => (
            <li
              key={alert}
              className="flex items-center gap-1.5 rounded-md border border-danger-border bg-surface px-2 py-1 text-[11.5px] leading-none font-medium text-danger"
            >
              <svg aria-hidden width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1.5 15 14H1L8 1.5Zm-.75 4.5v4h1.5V6h-1.5Zm0 5.25v1.5h1.5v-1.5h-1.5Z" />
              </svg>
              {alert}
            </li>
          ))}
        </ul>
      )}

      <dl className="m-0 mb-1.5 grid grid-cols-[118px_minmax(0,1fr)] gap-x-3 gap-y-2.5">
        <Detail label={t('quickView.fields.dateOfBirth')}>
          {patient.dateOfBirth ? formatCalendarDate(patient.dateOfBirth, locale) : NONE}
        </Detail>
        <Detail label={t('quickView.fields.phone')}>
          <span dir="ltr" className="font-mono tabular-nums">
            {formatPhone(patient.phone, tenant.country)}
          </span>
        </Detail>
        <Detail label={t('quickView.fields.email')}>{patient.email ?? NONE}</Detail>
        <Detail label={t('quickView.fields.insurance')}>{patient.insurance ?? NONE}</Detail>
        <Detail label={t('quickView.fields.dentist')}>{dentist}</Detail>
        {canPay && (
          <Detail label={t('billing:openBalance')}>
            <OpenBalance id={patient.id} tenant={tenant} locale={locale} />
          </Detail>
        )}
      </dl>

      {canAudit && (
        <ActivityTimeline
          patientId={patient.id}
          names={names}
          timeZone={tenant.timeZone}
          locale={locale}
        />
      )}
    </RightPanel>
  );
}
