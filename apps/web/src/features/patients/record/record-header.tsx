import type { LiveVisitRef, Patient, PatientContact, Session } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/list';
import { Tabs } from '@/components/ui/tabs';
import { usePermission } from '@/features/auth/use-permission';
import { StartVisitPopover } from '@/features/clinical/start-visit-popover';
import { liveVisitsQuery } from '@/features/clinical/visits-api';
import { formatAgeLine, formatPhone, todayIn } from '@/lib/format';
import { initials } from '@/lib/initials';
import { roleHolder } from '../contact-rows';
import { contactsQuery } from '../contacts-api';
import { minorOn } from '../patient-form';
import { usePatientNavigation } from '../patient-navigation';
import { patientQuery } from '../patients-api';
import { useArchivePatients } from '../use-archive-patients';
import { RECORD_TABS, type RecordTab } from './record-search';

type Tenant = NonNullable<Session['tenant']>;

/** "All patients": back to the previous screen when the app navigated here (README "Patient
 * record"), else — a bookmark, a fresh tab — to the list. */
export function BackToPatients() {
  const { t } = useTranslation('patients');
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (router.history.canGoBack()) router.history.back();
        else void router.navigate({ to: '/patients' });
      }}
      className="mb-3.5 flex cursor-pointer items-center gap-[5px] text-[11.5px] leading-none text-ink-muted hover:text-primary"
    >
      <svg
        aria-hidden
        width="11"
        height="11"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="rtl:-scale-x-100"
      >
        <path d="M10 3.5 5 8l5 4.5" />
      </svg>
      {t('record.back')}
    </button>
  );
}

function AlertIcon() {
  return (
    <svg
      aria-hidden
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className="flex-none"
    >
      <path d="M8 2.5 14.5 13.5H1.5L8 2.5Z" />
      <path d="M8 6.6v3" />
      <path d="M8 11.4h.01" />
    </svg>
  );
}

/**
 * A minor's guardian chip (design addendum "Record"): "Guardian · {name} · {phone}" in the
 * guardian indigo (`#eceef8` / `#c3c7ea`, 11.5px), the phone left-to-right. The amber "No
 * guardian recorded" note lives in the Contacts & family card, not here.
 */
function GuardianChip({ guardian, country }: { guardian: PatientContact; country: string }) {
  const { t } = useTranslation('patients');
  const { fullName, phone } = guardian.contact;
  return (
    <p className="m-0 inline-block rounded-md border border-primary-tint-border bg-primary-tint px-[9px] py-[5px] text-[11.5px] leading-none font-medium text-primary">
      {phone ? (
        <Trans
          t={t}
          i18nKey="record.guardianWithPhone"
          values={{ name: fullName, phone: formatPhone(phone, country) }}
          components={{ phone: <span dir="ltr" className="font-mono tabular-nums" /> }}
        />
      ) : (
        t('record.guardian', { name: fullName })
      )}
    </p>
  );
}

/** "This record was merged into P-…", linking to the kept record (design Q11). */
function MergedNotice({ keptId }: { keptId: string }) {
  const { t } = useTranslation('patients');
  const kept = useQuery(patientQuery(keptId));
  return (
    <p className="mt-3.5 mb-0 rounded-lg border border-border bg-faint px-3 py-2.5 text-[12.5px] leading-[1.45] text-ink-secondary">
      {t('record.mergedBody')}{' '}
      <Link
        to="/patients/$patientId"
        params={{ patientId: keptId }}
        className="font-medium text-primary hover:underline"
      >
        {kept.data
          ? t('record.mergedInto', { number: kept.data.displayNumber })
          : t('record.mergedIntoOther')}
      </Link>
    </p>
  );
}

/**
 * **Resume visit** — the patient's most recently started live visit (a merge can leave two, W1) —
 * or **Start visit**, which opens the start popover (spec §Record). An archived patient can't start
 * one but can still resume theirs. Both need `visit:write`: the front desk sees neither (W18).
 */
function VisitAction({ patientId, archived }: { patientId: string; archived: boolean }) {
  const { t } = useTranslation('patients');
  const navigate = useNavigate();
  const live = useQuery(liveVisitsQuery({ patientId }));
  if (live.isPending) return null;
  // Should the list fail, Start still gets there: starting resumes a live visit.
  const latest = (live.data ?? []).reduce<LiveVisitRef | undefined>(
    (found, visit) => (found && found.startedAt >= visit.startedAt ? found : visit),
    undefined,
  );
  if (latest) {
    return (
      <Button
        variant="primary"
        className="font-semibold"
        onClick={() => {
          void navigate({ to: '/visits/$visitId', params: { visitId: latest.id } });
        }}
      >
        {t('record.resumeVisit')}
      </Button>
    );
  }
  if (archived) return null;
  return (
    <StartVisitPopover patientId={patientId}>
      <Button variant="primary" className="font-semibold">
        {t('record.startVisit')}
      </Button>
    </StartVisitPopover>
  );
}

/**
 * The patient record's header (workspace spec §Screen 3 header, design §Patient record): the
 * "All patients" back link, the avatar, name and metadata (number, age line, phone), the medical
 * alert chips and — for a minor — the guardian chip, then Edit patient — or, for an archived
 * record, the Archived badge and Restore (never for a merged one: the server refuses it) — and
 * Start visit / Resume visit, and the tabs. No Add note yet.
 */
export function RecordHeader({
  patient,
  tenant,
  locale,
  tabsId,
  tab,
  onTab,
}: {
  patient: Patient;
  tenant: Tenant;
  locale: string;
  /** Ties the tabs to the page's `TabPanel`. */
  tabsId: string;
  tab: RecordTab;
  onTab: (tab: RecordTab) => void;
}) {
  const { t } = useTranslation('patients');
  const canWrite = usePermission('patient:write');
  const canVisit = usePermission('visit:write');
  const { editPatient } = usePatientNavigation();
  const archived = patient.archivedAt !== null;
  const merged = patient.mergedIntoId;

  // Restore (as the list's, with Undo), then — once the reloaded record swaps Restore for Edit
  // patient — focus lands on Edit patient rather than on the page.
  const actionsRef = useRef<HTMLDivElement>(null);
  const focusEdit = useRef(false);
  const restoring = useArchivePatients({
    onDone: () => undefined,
    focusAfter: () => {
      focusEdit.current = true;
    },
  });
  useEffect(() => {
    if (archived || !focusEdit.current) return;
    focusEdit.current = false;
    actionsRef.current?.querySelector('button')?.focus();
  }, [archived]);

  const today = todayIn(tenant.timeZone);
  const ageLine = formatAgeLine(patient.dateOfBirth, today, { locale });
  const minor = minorOn(patient.dateOfBirth, today);
  // A minor's guardian (the chip); nothing while the contacts load or when there is none.
  const contacts = useQuery({ ...contactsQuery(patient.id), enabled: minor });
  const guardian = minor && contacts.data ? roleHolder(contacts.data, 'guardian') : undefined;
  const age =
    ageLine.kind === 'full'
      ? t('record.ageLine', { age: t('ageYears', { count: ageLine.age }), dob: ageLine.dob })
      : ageLine.kind === 'dobOnly'
        ? ageLine.dob
        : t('record.ageUnknown');

  return (
    <header className="border-b border-border bg-surface px-[26px] pt-5">
      <BackToPatients />
      <div className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden
          className="grid size-[52px] flex-none place-items-center rounded-[10px] border border-primary-tint-border bg-primary-tint text-[18px] leading-none font-semibold text-primary"
        >
          {initials(patient.fullName)}
        </span>
        <div className="min-w-[220px]">
          <div className="mb-[5px] flex flex-wrap items-center gap-2.5">
            <h1 className="m-0 text-[22px] leading-[1.15] font-semibold tracking-[-0.02em]">
              {patient.fullName}
            </h1>
            {archived && <Pill tone="neutral">{t('record.archived')}</Pill>}
          </div>
          <div className="flex flex-wrap items-center gap-3.5 text-[12.5px] leading-none text-ink-tertiary">
            <span dir="ltr" className="font-mono">
              {patient.displayNumber}
            </span>
            <span>{age}</span>
            {patient.phone && (
              <span dir="ltr" className="font-mono tabular-nums">
                {formatPhone(patient.phone, tenant.country)}
              </span>
            )}
          </div>
        </div>
        {(patient.medicalAlerts.length > 0 || guardian) && (
          <div data-record-chips className="flex flex-wrap items-center gap-[7px] pt-1">
            {patient.medicalAlerts.length > 0 && (
              <ul
                aria-label={t('record.alerts')}
                className="m-0 flex list-none flex-wrap gap-[7px] p-0"
              >
                {patient.medicalAlerts.map((alert) => (
                  <li
                    key={alert}
                    className="inline-flex items-center gap-[5px] rounded-md border border-warning-border bg-warning-bg px-[9px] py-[5px] text-[11.5px] leading-none font-medium text-warning"
                  >
                    <AlertIcon />
                    {alert}
                  </li>
                ))}
              </ul>
            )}
            {guardian && <GuardianChip guardian={guardian} country={tenant.country} />}
          </div>
        )}
        {(canWrite || canVisit) && merged === null && (
          <div ref={actionsRef} className="ms-auto flex gap-2 pt-1">
            {canWrite &&
              (archived ? (
                <Button
                  busy={restoring.busy}
                  onClick={() => {
                    restoring.restore([patient]);
                  }}
                >
                  {t('record.restore')}
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    editPatient(patient.id);
                  }}
                >
                  {t('record.edit')}
                </Button>
              ))}
            {canVisit && <VisitAction patientId={patient.id} archived={archived} />}
          </div>
        )}
      </div>
      {merged !== null && <MergedNotice keptId={merged} />}
      <Tabs
        idBase={tabsId}
        label={t('record.tabs.label')}
        tabs={RECORD_TABS.map((key) => ({ key, label: t(`record.tabs.${key}`) }))}
        active={tab}
        onChange={onTab}
        className="mt-[18px]"
      />
    </header>
  );
}
