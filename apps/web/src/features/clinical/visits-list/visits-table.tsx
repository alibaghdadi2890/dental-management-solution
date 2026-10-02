import { formatVisitNumber, type VisitBalance, type VisitListItem } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { Pill, SHIMMER, TableHead } from '@/components/ui/list';
import { PatientAvatar } from '@/features/patients/patients-table';
import { formatDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useToothLabel } from '../chart/use-chart-settings';
import { useElapsedText } from '../use-visit-timer';

/** Visit · Date/time · Patient · Dentist · Services · Total · Balance · Status (spec §Visits
 * page; the room sits under the date). */
export const VISIT_COLUMNS =
  '96px 124px minmax(170px,1.2fr) 112px minmax(160px,1.3fr) 88px 92px 108px';
export const VISIT_TABLE_MIN_WIDTH = 1000;

const NONE = '—';

export function VisitsTableHead() {
  const { t } = useTranslation('visits');
  return (
    <TableHead
      columns={VISIT_COLUMNS}
      labels={[
        t('columns.visit'),
        t('columns.date'),
        t('columns.patient'),
        t('columns.dentist'),
        t('columns.services'),
        <span key="total" className="block text-end">
          {t('columns.total')}
        </span>,
        <span key="balance" className="block text-end">
          {t('columns.balance')}
        </span>,
        t('columns.status'),
      ]}
    />
  );
}

const STATUS_TONES = {
  in_progress: 'indigo',
  paused: 'indigo',
  completed: 'success',
  amended: 'warning',
  voided: 'neutral',
  discarded: 'neutral',
} as const;

export function VisitStatusPill({ status }: { status: VisitListItem['status'] }) {
  const { t } = useTranslation('visits');
  return <Pill tone={STATUS_TONES[status]}>{t(`status.${status}`)}</Pill>;
}

/** "Filling #16, Cleaning" — tooth labels in the clinic's notation. */
function useServicesText(): (visit: VisitListItem) => string {
  const toothLabel = useToothLabel();
  return (visit) =>
    visit.services
      .map((service) =>
        service.toothCode === null
          ? service.name
          : `${service.name} ${toothLabel(service.toothCode)}`,
      )
      .join(', ');
}

function LiveDuration({ visit, receivedAt }: { visit: VisitListItem; receivedAt: number }) {
  const elapsed = useElapsedText(visit, receivedAt);
  return <span className="font-mono">{elapsed}</span>;
}

export interface VisitRowContext {
  timeZone: string;
  locale: string;
  /** Balances are shown with `payment:read` only. */
  canPay: boolean;
  /** When the page's data arrived, for the live rows' running duration. */
  receivedAt: number;
}

/**
 * One visit: a voided one at 70 % with its total struck through, live ones with a running
 * duration in place of the balance. The row opens the detail panel.
 */
export function VisitRow({
  visit,
  context,
  balance,
  balanceLoading,
  open,
  stale,
  onOpen,
}: {
  visit: VisitListItem;
  context: VisitRowContext;
  balance: VisitBalance | undefined;
  balanceLoading: boolean;
  open: boolean;
  stale: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation('visits');
  const servicesText = useServicesText();
  const voided = visit.status === 'voided';
  const live = visit.status === 'in_progress' || visit.status === 'paused';
  const time = new Intl.DateTimeFormat(context.locale === 'en' ? 'en-GB' : context.locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: context.timeZone,
  }).format(new Date(visit.startedAt));
  const money = (amount: string) =>
    formatMoney({ amount, currency: visit.currency }, context.locale);

  let balanceCell;
  if (live) {
    balanceCell = <LiveDuration visit={visit} receivedAt={context.receivedAt} />;
  } else if (voided || !context.canPay) {
    balanceCell = NONE;
  } else if (balanceLoading) {
    balanceCell = <span className={cn('inline-block h-2.5 w-12', SHIMMER)} />;
  } else if (!balance || Number(balance.outstanding) <= 0) {
    balanceCell = <span className="font-medium text-success">{t('paid')}</span>;
  } else {
    balanceCell = <span className="font-medium text-danger">{money(balance.outstanding)}</span>;
  }

  return (
    <div
      role="row"
      aria-selected={open}
      onClick={stale ? undefined : onOpen}
      className={cn(
        'grid min-h-14 items-center gap-2.5 border-t border-row-divider px-3 py-1.5',
        !stale && 'cursor-pointer hover:bg-faint',
        open ? 'bg-selected' : 'bg-surface',
        stale ? 'opacity-60' : voided && 'opacity-70',
      )}
      style={{ gridTemplateColumns: VISIT_COLUMNS }}
    >
      <span role="cell" className="font-mono text-[12.5px] font-medium text-primary">
        <button
          type="button"
          disabled={stale}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className="cursor-pointer disabled:cursor-default"
        >
          <span dir="ltr">{formatVisitNumber(visit.displayNumber)}</span>
        </button>
      </span>
      <span role="cell" className="min-w-0 text-[12.5px] leading-[1.35]">
        <span className="block">{formatDate(visit.startedAt, context)}</span>
        <span className="block truncate font-mono text-[11.5px] text-ink-muted">
          {visit.room ? `${time} · ${visit.room.name}` : time}
        </span>
      </span>
      <span role="cell" className="flex min-w-0 items-center gap-2.5">
        <PatientAvatar name={visit.patient.fullName} />
        <span className="min-w-0">
          <span className="block truncate text-[13px] leading-[1.3] font-medium">
            {visit.patient.fullName}
          </span>
          <span className="block font-mono text-[11.5px] leading-[1.4] text-ink-muted">
            <span dir="ltr">{visit.patient.displayNumber}</span>
          </span>
        </span>
      </span>
      <span role="cell" className="truncate text-[12.5px] text-ink-secondary">
        {visit.dentist.name || NONE}
      </span>
      <span
        role="cell"
        className="line-clamp-2 text-[12.5px] leading-[1.35] text-ink-secondary"
        title={servicesText(visit)}
      >
        {servicesText(visit) || NONE}
      </span>
      <span
        role="cell"
        className={cn('text-end font-mono text-[12.5px] font-medium', voided && 'line-through')}
      >
        {money(visit.total)}
      </span>
      <span role="cell" className="text-end font-mono text-[12.5px]">
        {balanceCell}
      </span>
      <span role="cell">
        <VisitStatusPill status={visit.status} />
      </span>
    </div>
  );
}
