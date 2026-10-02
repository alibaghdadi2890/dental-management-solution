import {
  type BalanceMoney,
  type PatientListItem,
  type PatientListQuery,
  type VisitStat,
} from '@dcm/contracts';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SHIMMER } from '@/components/ui/list';
import { owedBalances } from '@/features/billing/owed-balances';
import { ageOrNull, formatCalendarDate, formatMoney, formatPhone } from '@/lib/format';
import { firstName, initials } from '@/lib/initials';
import { cn } from '@/lib/utils';
import type { SortableColumn } from './list-query';
import { minorOn } from './patient-form';

/** POC column widths: checkbox · Patient · Age·sex · Phone · Last visit · Dentist · Visits ·
 * Balance · ⋯ (README §Patients, list anatomy 5). */
const PATIENT_COLUMNS = '40px minmax(200px,1.6fr) 80px 128px 112px 118px 58px 92px 44px';
export const PATIENT_TABLE_MIN_WIDTH = 940;

const NONE = '—';

function SortHeader({
  column,
  label,
  query,
  onSort,
  end = false,
}: {
  column: SortableColumn;
  label: string;
  query: PatientListQuery;
  onSort: (column: SortableColumn) => void;
  end?: boolean;
}) {
  const active = query.sort === column;
  return (
    <span
      role="columnheader"
      aria-sort={active ? (query.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn('flex', end && 'justify-end')}
    >
      <button
        type="button"
        onClick={() => {
          onSort(column);
        }}
        className={cn(
          'flex cursor-pointer items-center gap-1 text-[11.5px] leading-none font-medium tracking-[0.05em] uppercase',
          active ? 'text-primary' : 'text-ink-muted',
        )}
      >
        <span>{label}</span>
        {active && (
          <span aria-hidden className="font-mono text-primary">
            {query.dir === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </button>
    </span>
  );
}

function PlainHeader({ label, end = false }: { label: string; end?: boolean }) {
  return (
    <span
      role="columnheader"
      className={cn(
        'text-[11.5px] leading-none font-medium tracking-[0.05em] text-ink-muted uppercase',
        end && 'text-end',
      )}
    >
      {label}
    </span>
  );
}

const checkboxClass = 'ms-0.5 size-[15px] cursor-pointer accent-primary';

/** 40px header row with the page's select-all checkbox and the sortable column labels. Visits and
 * Last visit are not sortable (4b, D18); Balance only with `payment:read`. */
export function PatientsTableHead({
  query,
  onSort,
  canSortBalance,
  selection,
  onToggleAll,
  selectable,
}: {
  query: PatientListQuery;
  onSort: (column: SortableColumn) => void;
  canSortBalance: boolean;
  /** How much of the page is selected; `some` shows the select-all box as indeterminate. */
  selection: 'none' | 'some' | 'all';
  onToggleAll: () => void;
  selectable: boolean;
}) {
  const { t } = useTranslation('patients');
  return (
    <div
      role="row"
      className="grid h-10 items-center gap-2.5 border-b border-border bg-faint px-3"
      style={{ gridTemplateColumns: PATIENT_COLUMNS }}
    >
      <span role="columnheader">
        <input
          type="checkbox"
          aria-label={t('columns.selectAll')}
          ref={(input) => {
            if (input) input.indeterminate = selection === 'some';
          }}
          checked={selection === 'all'}
          disabled={!selectable}
          onChange={onToggleAll}
          className={checkboxClass}
        />
      </span>
      <SortHeader column="name" label={t('columns.patient')} query={query} onSort={onSort} />
      <SortHeader column="age" label={t('columns.age')} query={query} onSort={onSort} />
      <PlainHeader label={t('columns.phone')} />
      <PlainHeader label={t('columns.lastVisit')} />
      <SortHeader column="dentist" label={t('columns.dentist')} query={query} onSort={onSort} />
      <PlainHeader label={t('columns.visits')} end />
      {canSortBalance ? (
        <SortHeader
          column="balance"
          label={t('columns.balance')}
          query={query}
          onSort={onSort}
          end
        />
      ) : (
        <PlainHeader label={t('columns.balance')} end />
      )}
      <span role="columnheader">
        <span className="sr-only">{t('columns.actions')}</span>
      </span>
    </div>
  );
}

const SKELETON_NAME_WIDTHS = [180, 140, 200, 120, 160, 150, 190, 130];
const bar = (width: string) => cn('h-2.5', SHIMMER, width);

/** Loading rows shaped like the POC's: checkbox, avatar + name, then each column's typical width. */
export function PatientsSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      {SKELETON_NAME_WIDTHS.map((width) => (
        <div
          key={width}
          className="grid h-14 items-center gap-2.5 border-t border-row-divider px-3"
          style={{ gridTemplateColumns: PATIENT_COLUMNS }}
        >
          <span className="size-[15px] rounded-[3px] bg-subtle" />
          <span className="flex items-center gap-2.5">
            <span className={cn('size-7 rounded-full', SHIMMER)} />
            <span className={cn('h-2.5', SHIMMER)} style={{ width }} />
          </span>
          <span className={bar('w-11')} />
          <span className={bar('w-24')} />
          <span className={bar('w-[78px]')} />
          <span className={bar('w-[86px]')} />
          <span className="h-2.5 w-5 rounded-sm bg-subtle" />
          <span className="h-2.5 w-[52px] justify-self-end rounded-sm bg-subtle" />
          <span />
        </div>
      ))}
    </div>
  );
}

const AVATAR_TONES = [
  'bg-primary-tint text-primary',
  'bg-avatar-amber text-warning',
  'bg-success-bg text-success',
  'bg-avatar-rose text-avatar-rose-ink',
  'bg-avatar-violet text-avatar-violet-ink',
] as const;

/** Round avatar, 28px in rows and 40px in the quick view; the POC picks its tone from the name's
 * length. */
export function PatientAvatar({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid flex-none place-items-center rounded-full leading-none font-semibold',
        large ? 'size-10 text-[14px]' : 'size-7 text-[11.5px]',
        AVATAR_TONES[name.length % AVATAR_TONES.length],
      )}
    >
      {initials(name)}
    </span>
  );
}

const badge =
  'h-[18px] flex-none rounded-[4px] border px-1.5 text-[11.5px] leading-4 font-medium whitespace-nowrap';

function BalanceCell({
  balances,
  loading,
  currency,
  locale,
}: {
  balances: readonly BalanceMoney[] | undefined;
  loading: boolean;
  currency: string;
  locale: string;
}) {
  if (loading) {
    return (
      <span role="cell" aria-busy="true" className="flex justify-end">
        <span className={bar('w-[52px]')} />
      </span>
    );
  }
  const all = balances ? owedBalances(balances, currency) : [];
  const [lead] = all;
  const amount = lead ? Number(lead.amount) : 0;
  return (
    <span
      role="cell"
      title={all.length > 1 ? all.map((b) => formatMoney(b, locale)).join(' · ') : undefined}
      className={cn(
        'text-end font-mono text-[12.5px] leading-none tabular-nums',
        amount > 0 ? 'font-semibold text-danger' : 'text-ink-muted',
      )}
    >
      {lead ? formatMoney(lead, locale) : NONE}
    </span>
  );
}

/**
 * The Phone cell (design addendum C7): for a minor (by the date of birth, on the tenant's today)
 * with a primary guardian who has a phone, that phone — who to call — with an 11.5px muted
 * "via {first name}" beneath; otherwise the patient's own phone, or "—".
 */
function PhoneCell({
  patient,
  today,
  country,
}: {
  patient: PatientListItem;
  today: string;
  country: string;
}) {
  const { t } = useTranslation('patients');
  const guardian = minorOn(patient.dateOfBirth, today) ? patient.primaryGuardian : null;
  const phone = guardian?.phone ?? patient.phone;
  return (
    <span
      role="cell"
      className="font-mono text-[12.5px] leading-none whitespace-nowrap text-ink-secondary tabular-nums"
    >
      {phone ? <span dir="ltr">{formatPhone(phone, country)}</span> : NONE}
      {guardian?.phone && (
        <span className="mt-1 block truncate font-sans text-[11.5px] leading-[1.3] text-ink-muted">
          {t('row.via', { name: firstName(guardian.fullName) })}
        </span>
      )}
    </span>
  );
}

export interface PatientRowContext {
  /** Today in the tenant's time zone (`YYYY-MM-DD`). */
  today: string;
  country: string;
  currency: string;
  locale: string;
  dentistNames: ReadonlyMap<string, string>;
}

export function PatientRow({
  patient,
  context,
  balances,
  balanceLoading,
  visits,
  visitsLoading,
  selected,
  highlighted,
  stale,
  onToggle,
  onOpen,
  menu,
}: {
  patient: PatientListItem;
  context: PatientRowContext;
  /** `undefined` without `payment:read`, with no ledger entries, or while `balanceLoading`. */
  balances: readonly BalanceMoney[] | undefined;
  /** This page's balances are still loading: the cell shimmers rather than reading "—". */
  balanceLoading: boolean;
  /** Counted visits (4b, D18); `undefined` while `visitsLoading`. */
  visits: VisitStat | undefined;
  visitsLoading: boolean;
  selected: boolean;
  /** The row whose panel is open. */
  highlighted: boolean;
  /** A row of the previous query, shown while the next one loads: dimmed and inert. */
  stale: boolean;
  onToggle: () => void;
  onOpen: () => void;
  menu: ReactNode;
}) {
  const { t } = useTranslation('patients');
  const archived = patient.archivedAt !== null;
  const years = ageOrNull(patient.dateOfBirth, context.today);
  const age = years === null ? NONE : String(years);
  const ageSex =
    patient.sex === 'unknown' ? age : t('ageSex', { age, sex: t(`sex.${patient.sex}`) });
  const [firstAlert] = patient.medicalAlerts;
  const alertWord = firstAlert?.split(/[\s—(]/)[0] ?? '';
  const alertBadge =
    patient.medicalAlerts.length > 1
      ? t('alertBadge', { alert: alertWord, more: patient.medicalAlerts.length - 1 })
      : alertWord;
  const dentist = patient.primaryDentistId
    ? (context.dentistNames.get(patient.primaryDentistId) ?? NONE)
    : NONE;

  return (
    <div
      role="row"
      onClick={stale ? undefined : onOpen}
      className={cn(
        'grid min-h-14 items-center gap-2.5 border-t border-row-divider px-3 py-1.5',
        !stale && 'cursor-pointer hover:bg-faint',
        selected ? 'bg-selected' : highlighted ? 'bg-faint' : 'bg-surface',
        stale ? 'opacity-60' : archived && 'opacity-75',
      )}
      style={{ gridTemplateColumns: PATIENT_COLUMNS }}
    >
      <span
        role="cell"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <input
          type="checkbox"
          aria-label={t('row.select', { name: patient.fullName })}
          checked={selected}
          disabled={stale}
          onChange={onToggle}
          className={checkboxClass}
        />
      </span>
      <span role="cell" className="min-w-0">
        <button
          type="button"
          disabled={stale}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className="flex max-w-full min-w-0 cursor-pointer items-center gap-2.5 text-start disabled:cursor-default"
        >
          <PatientAvatar name={patient.fullName} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[13px] leading-[1.3] font-medium">
                {patient.fullName}
              </span>
              {firstAlert !== undefined && (
                <span
                  title={patient.medicalAlerts.join(', ')}
                  className={cn(badge, 'border-danger-border bg-danger-bg text-danger')}
                >
                  {alertBadge}
                </span>
              )}
              {archived && (
                <span className={cn(badge, 'border-border bg-subtle text-ink-secondary')}>
                  {t('archivedBadge')}
                </span>
              )}
            </span>
            <span className="block font-mono text-[11.5px] leading-[1.4] text-ink-muted">
              <span dir="ltr">{patient.displayNumber}</span>
            </span>
          </span>
        </button>
      </span>
      <span role="cell" className="text-[12.5px] leading-none text-ink-secondary">
        {ageSex}
      </span>
      <PhoneCell patient={patient} today={context.today} country={context.country} />
      <span role="cell" className="text-[12.5px] leading-[1.3] text-ink-secondary">
        {visitsLoading ? (
          <span className={bar('w-16')} />
        ) : visits?.lastVisitDate ? (
          formatCalendarDate(visits.lastVisitDate, context.locale)
        ) : (
          NONE
        )}
      </span>
      <span role="cell" className="truncate text-[12.5px] leading-[1.3] text-ink-secondary">
        {dentist}
      </span>
      <span
        role="cell"
        className="text-end font-mono text-[12.5px] leading-none text-ink-secondary"
      >
        {visitsLoading ? <span className={bar('ms-auto w-5')} /> : String(visits?.visitCount ?? 0)}
      </span>
      <BalanceCell
        balances={balances}
        loading={balanceLoading}
        currency={context.currency}
        locale={context.locale}
      />
      <span
        role="cell"
        className="justify-self-end"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        {menu}
      </span>
    </div>
  );
}
