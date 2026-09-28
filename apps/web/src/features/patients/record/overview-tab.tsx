import type { Patient, PatientContact, Session } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { SHIMMER } from '@/components/ui/list';
import { usePermission } from '@/features/auth/use-permission';
import { BalanceCard } from '@/features/billing/balance-card';
import { formatCalendarDate, formatMoney, formatPhone } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CONTACT_ROLES, type ContactRole, roleHolder } from '../contact-rows';
import { contactsQuery } from '../contacts-api';

type Tenant = NonNullable<Session['tenant']>;

const SUMMARY_ROWS = ['visits', 'diagnoses', 'planned', 'teeth', 'services'] as const;

/** Until visits, diagnoses and plans exist (features 4+), every count is zero. */
function TreatmentSummary({ tenant, locale }: { tenant: Tenant; locale: string }) {
  const { t } = useTranslation('patients');
  const zero = new Intl.NumberFormat(locale).format(0);
  const rows: [string, string][] = [
    ...SUMMARY_ROWS.map((key): [string, string] => [t(`record.summary.${key}`), zero]),
    [t('record.summary.billed'), formatMoney({ amount: '0', currency: tenant.currency }, locale)],
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
 * The record's Overview (workspace spec §Tab: Overview). The Last visit and Dental status cards
 * wait for visits and charting; until then the left column holds the patient's details and the
 * right one the Balance (`payment:read` only) above the Treatment summary.
 */
export function OverviewTab({
  patient,
  tenant,
  locale,
  onComplete,
}: {
  patient: Patient;
  tenant: Tenant;
  locale: string;
  /** "Complete →": the Patient information tab. */
  onComplete: () => void;
}) {
  const canPay = usePermission('payment:read');
  const canWrite = usePermission('patient:write');
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-4">
        <PatientInfoCard
          patient={patient}
          tenant={tenant}
          locale={locale}
          onComplete={canWrite ? onComplete : undefined}
        />
      </div>
      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
        {canPay && (
          <BalanceCard patientId={patient.id} currency={tenant.currency} locale={locale} />
        )}
        <TreatmentSummary tenant={tenant} locale={locale} />
      </div>
    </div>
  );
}
