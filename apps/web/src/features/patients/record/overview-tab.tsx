import type {
  ClinicalSummary,
  Patient,
  PatientContact,
  Session,
  ToothCode,
  ToothState,
} from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardSkeleton } from '@/components/ui/card';
import { SHIMMER } from '@/components/ui/list';
import { usePermission } from '@/features/auth/use-permission';
import { BalanceCard } from '@/features/billing/balance-card';
import { balanceQuery } from '@/features/billing/billing-api';
import { DentalChart } from '@/features/clinical/chart/dental-chart';
import { useLevelLabel, useToothLabel } from '@/features/clinical/chart/use-chart-settings';
import { ToothHistoryDialog } from '@/features/clinical/dialogs/tooth-history-dialog';
import { chartQuery, clinicalSummaryQuery, lastVisitQuery } from '@/features/clinical/visits-api';
import { formatCalendarDate, formatMoney, formatPhone } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CONTACT_ROLES, type ContactRole, roleHolder } from '../contact-rows';
import { contactsQuery } from '../contacts-api';

type Tenant = NonNullable<Session['tenant']>;

const NONE = '—';

/** A card's load failure, in place of its body. */
function Failed({ children }: { children: string }) {
  return (
    <p role="alert" className="m-0 text-[12.5px] leading-snug text-ink-muted">
      {children}
    </p>
  );
}

const SUMMARY_ROWS = [
  ['visits', 'visits'],
  ['diagnoses', 'activeDiagnoses'],
  ['planned', 'plannedProcedures'],
  ['teeth', 'teethTreated'],
  ['services', 'servicesPerformed'],
] as const satisfies readonly (readonly [string, keyof ClinicalSummary])[];

/**
 * The Treatment summary (spec W8): `clinical`'s five counts, then _Lifetime billed_ — the
 * patient's visit charges in the tenant currency, from the balance (`payment:read`; the row is
 * left out without it, and reads "—" until the balance is in).
 */
function TreatmentSummary({
  patientId,
  tenant,
  locale,
  canPay,
}: {
  patientId: string;
  tenant: Tenant;
  locale: string;
  canPay: boolean;
}) {
  const { t } = useTranslation('patients');
  const summary = useQuery(clinicalSummaryQuery(patientId));
  const balance = useQuery({ ...balanceQuery(patientId), enabled: canPay });

  if (!summary.data) {
    return (
      <Card title={t('record.summary.title')}>
        {summary.isError ? (
          <Failed>{t('record.summary.failed')}</Failed>
        ) : (
          <CardSkeleton label={t('record.summary.loading')} />
        )}
      </Card>
    );
  }
  const counts = summary.data;
  const number = new Intl.NumberFormat(locale);
  const billed = balance.data
    ? formatMoney(
        balance.data.charged.find((money) => money.currency === tenant.currency) ?? {
          amount: '0',
          currency: tenant.currency,
        },
        locale,
      )
    : NONE;
  const rows: [string, string][] = [
    ...SUMMARY_ROWS.map(([key, field]): [string, string] => [
      t(`record.summary.${key}`),
      number.format(counts[field]),
    ]),
    ...(canPay ? [[t('record.summary.billed'), billed] satisfies [string, string]] : []),
  ];
  return (
    <Card title={t('record.summary.title')}>
      <dl className="m-0">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 border-b border-row-divider py-2"
          >
            <dt className="text-[12.5px] leading-[1.3] text-ink-secondary">{label}</dt>
            <dd className="m-0 font-mono text-[12.5px] leading-none font-semibold tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

const MICRO =
  'mb-[5px] text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal';

/**
 * The Last visit card (spec §Tab: Overview): the most recently completed visit's date, dentist,
 * duration and total, its services as chips ("Composite filling · #16", or "· Jaw" for a
 * jaw-level one) and its clinical note as a quote. Without a completed visit, dashes and "No
 * visits recorded yet." "All visits →" opens the Visits & history tab.
 */
function LastVisitCard({
  patientId,
  locale,
  onAllVisits,
}: {
  patientId: string;
  locale: string;
  onAllVisits: () => void;
}) {
  const { t } = useTranslation('patients');
  const label = useToothLabel();
  const levelLabel = useLevelLabel();
  const lastVisit = useQuery(lastVisitQuery(patientId));

  let body: ReactNode;
  if (lastVisit.isPending) {
    body = <CardSkeleton label={t('record.lastVisit.loading')} />;
  } else if (lastVisit.isError) {
    body = <Failed>{t('record.lastVisit.failed')}</Failed>;
  } else {
    const visit = lastVisit.data;
    const facts = [
      {
        key: 'date',
        value: visit ? formatCalendarDate(visit.date, locale) : NONE,
        className: 'font-medium',
      },
      { key: 'dentist', value: visit?.dentistName ?? NONE, className: 'font-medium' },
      {
        key: 'duration',
        value: visit ? t('record.lastVisit.minutes', { minutes: visit.durationMinutes }) : NONE,
        className: 'font-mono font-medium',
      },
      {
        key: 'total',
        value: visit ? formatMoney(visit.total, locale) : NONE,
        className: 'font-mono font-semibold tabular-nums',
      },
    ] as const;
    const note = visit ? visit.notes.trim() : t('record.lastVisit.none');
    body = (
      <>
        <dl className="m-0 mb-3.5 flex flex-wrap gap-[26px]">
          {facts.map((fact) => (
            <div key={fact.key}>
              <dt className={MICRO}>{t(`record.lastVisit.${fact.key}`)}</dt>
              <dd className={cn('m-0 text-[13px] leading-none', fact.className)}>{fact.value}</dd>
            </div>
          ))}
        </dl>
        {visit && visit.services.length > 0 && (
          <ul
            aria-label={t('record.lastVisit.services')}
            className="m-0 mb-3 flex list-none flex-wrap gap-[7px] p-0"
          >
            {visit.services.map((service, index) => (
              <li
                key={index}
                className="rounded-md border border-border bg-faint px-[9px] py-[5px] text-[12.5px] leading-none font-medium text-ink-secondary"
              >
                {t('record.lastVisit.chip', {
                  name: service.name,
                  target:
                    service.toothCode === null ? levelLabel(service.jaw) : label(service.toothCode),
                })}
              </li>
            ))}
          </ul>
        )}
        {note && (
          <blockquote className="m-0 rounded-e-md border-s-2 border-border-strong bg-faint px-[13px] py-[11px] text-[12.5px] leading-[1.6] whitespace-pre-line text-ink-secondary">
            {note}
          </blockquote>
        )}
      </>
    );
  }
  return (
    <Card
      title={t('record.lastVisit.title')}
      action={
        <button
          type="button"
          onClick={onAllVisits}
          className="cursor-pointer text-[12.5px] font-medium text-primary hover:underline"
        >
          {t('record.lastVisit.all')}
        </button>
      }
    >
      {body}
    </Card>
  );
}

/**
 * The Dental status card (spec §Tab: Overview): the patient's chart at 8 px cells, read-only —
 * charting happens only in a visit — where a click on a tooth opens its history.
 */
function DentalStatusCard({
  patientId,
  onOpenHistory,
}: {
  patientId: string;
  onOpenHistory: (code: ToothCode) => void;
}) {
  const { t } = useTranslation('patients');
  const chart = useQuery(chartQuery(patientId));
  const teeth = useMemo(
    () => new Map<ToothCode, ToothState>(chart.data?.teeth.map((tooth) => [tooth.code, tooth])),
    [chart.data],
  );
  return (
    <Card
      title={t('record.dental.title')}
      action={
        <span className="text-[12.5px] leading-none text-ink-muted">{t('record.dental.hint')}</span>
      }
    >
      {chart.data ? (
        <DentalChart
          teeth={teeth}
          dentition={chart.data.dentition.stage}
          size={8}
          onToothClick={onOpenHistory}
        />
      ) : chart.isError ? (
        <Failed>{t('record.dental.failed')}</Failed>
      ) : (
        <CardSkeleton label={t('record.dental.loading')} />
      )}
    </Card>
  );
}

/** A value, or the literal "Not recorded" in muted text (workspace spec: progressive disclosure
 * stays visible rather than hidden). */
function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode | null;
  mono?: boolean;
}) {
  const { t } = useTranslation('patients');
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2.5 border-b border-row-divider py-[7px]">
      <dt className="text-[12.5px] leading-[1.4] text-ink-muted">{label}</dt>
      <dd
        className={cn(
          'm-0 text-[12.5px] leading-[1.4] [overflow-wrap:anywhere]',
          value === null ? 'text-ink-muted' : mono && 'font-mono tabular-nums',
        )}
      >
        {value ?? t('record.info.notRecorded')}
      </dd>
    </div>
  );
}

/** Each role's holder (its primary, else its first holder), one entry per person, in role order
 * (guardian, billing, emergency). */
function primaries(links: readonly PatientContact[]) {
  const people: { name: string; roles: ContactRole[] }[] = [];
  const byContact = new Map<string, { name: string; roles: ContactRole[] }>();
  for (const role of CONTACT_ROLES) {
    const link = roleHolder(links, role);
    if (!link) continue;
    const known = byContact.get(link.contact.id);
    if (known) {
      known.roles.push(role);
      continue;
    }
    const person = { name: link.contact.fullName, roles: [role] };
    byContact.set(link.contact.id, person);
    people.push(person);
  }
  return people;
}

/**
 * The Contacts row (design addendum "Record", in place of the base design's Emergency row): who
 * the primary guardian, billing and emergency contacts are — "Guardian: Maria Haddad · Billing:
 * Karim Haddad", one person holding several roles named once ("Maria Haddad (guardian, billing)")
 * — or "Not recorded".
 */
function ContactsValue({ patient }: { patient: Patient }) {
  const { t, i18n } = useTranslation('patients');
  const contacts = useQuery(contactsQuery(patient.id));
  if (contacts.isPending) {
    return (
      <span
        role="status"
        aria-label={t('contacts.current.loading')}
        className={cn('inline-block h-2.5 w-40 align-middle', SHIMMER)}
      />
    );
  }
  if (contacts.isError) {
    return <span className="text-ink-muted">{t('contacts.current.failed')}</span>;
  }
  const people = primaries(contacts.data);
  if (people.length === 0) {
    return <span className="text-ink-muted">{t('record.info.notRecorded')}</span>;
  }
  const list = new Intl.ListFormat(i18n.resolvedLanguage ?? 'en', {
    style: 'short',
    type: 'unit',
  });
  return people
    .map(({ name, roles }) => {
      const [only] = roles;
      return roles.length === 1 && only
        ? t('record.info.contactRole', { role: t(`contacts.roles.${only}`), name })
        : t('record.info.contactRoles', {
            name,
            roles: list.format(roles.map((role) => t(`record.info.roleWords.${role}`))),
          });
    })
    .join(' · ');
}

function PatientInfoCard({
  patient,
  tenant,
  locale,
  onComplete,
}: {
  patient: Patient;
  tenant: Tenant;
  locale: string;
  /** "Complete →", only for those who may edit the patient. */
  onComplete: (() => void) | undefined;
}) {
  const { t } = useTranslation('patients');
  return (
    <Card
      title={t('record.info.title')}
      action={
        onComplete && (
          <button
            type="button"
            onClick={onComplete}
            className="flex cursor-pointer items-center gap-1 text-[12.5px] leading-none font-medium text-primary hover:underline"
          >
            {t('record.info.complete')}
            <span aria-hidden className="rtl:-scale-x-100">
              {'→'}
            </span>
          </button>
        )
      }
    >
      <dl className="m-0">
        <InfoRow
          label={t('record.info.phone')}
          mono
          value={
            patient.phone ? (
              <span dir="ltr">{formatPhone(patient.phone, tenant.country)}</span>
            ) : null
          }
        />
        <InfoRow
          label={t('record.info.dateOfBirth')}
          mono
          value={patient.dateOfBirth ? formatCalendarDate(patient.dateOfBirth, locale) : null}
        />
        <InfoRow label={t('record.info.email')} value={patient.email} />
        <InfoRow label={t('record.info.address')} value={patient.address} />
        <InfoRow label={t('record.info.insurance')} value={patient.insurance} />
        <InfoRow label={t('record.info.contacts')} value={<ContactsValue patient={patient} />} />
      </dl>
    </Card>
  );
}

/**
 * The record's Overview (workspace spec §Tab: Overview): with `visit:read`, the Last visit and
 * Dental status cards on the left, and on the right the Balance (`payment:read` only), the
 * Treatment summary and the patient's details. Without it, the details take the left column. A
 * tooth clicked in the chart opens its history.
 */
export function OverviewTab({
  patient,
  tenant,
  locale,
  onComplete,
  onAllVisits,
}: {
  patient: Patient;
  tenant: Tenant;
  locale: string;
  /** "Complete →": the Patient information tab. */
  onComplete: () => void;
  /** The Last visit card's "All visits →": the Visits & history tab. */
  onAllVisits: () => void;
}) {
  const canPay = usePermission('payment:read');
  const canWrite = usePermission('patient:write');
  const canVisits = usePermission('visit:read');
  const [historyTooth, setHistoryTooth] = useState<ToothCode | null>(null);
  const info = (
    <PatientInfoCard
      patient={patient}
      tenant={tenant}
      locale={locale}
      onComplete={canWrite ? onComplete : undefined}
    />
  );
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-4">
        {canVisits ? (
          <>
            <LastVisitCard patientId={patient.id} locale={locale} onAllVisits={onAllVisits} />
            <DentalStatusCard patientId={patient.id} onOpenHistory={setHistoryTooth} />
          </>
        ) : (
          info
        )}
      </div>
      {(canPay || canVisits) && (
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          {canPay && (
            <BalanceCard patientId={patient.id} currency={tenant.currency} locale={locale} />
          )}
          {canVisits && (
            <>
              <TreatmentSummary
                patientId={patient.id}
                tenant={tenant}
                locale={locale}
                canPay={canPay}
              />
              {info}
            </>
          )}
        </div>
      )}
      {canVisits && (
        <ToothHistoryDialog
          patientId={patient.id}
          patientName={patient.fullName}
          code={historyTooth}
          onCodeChange={setHistoryTooth}
          canStart={patient.archivedAt === null}
        />
      )}
    </div>
  );
}
