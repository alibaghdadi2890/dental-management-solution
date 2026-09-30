import type { LiveVisitRef } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { usePermission } from '@/features/auth/use-permission';
import { firstName } from '@/lib/initials';
import { cn } from '@/lib/utils';
import { useElapsedText } from './use-visit-timer';
import { liveVisitsQuery } from './visits-api';

/** How often the pill picks up visits started, paused or completed elsewhere. */
export const LIVE_PILL_REFETCH_MS = 30_000;

const PILL =
  'flex h-8 flex-none cursor-pointer items-center gap-2 rounded-[7px] border border-primary-tint-border bg-primary-tint px-3 text-primary hover:border-primary-tint-strong';

function Dot({ running }: { running: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'size-1.5 flex-none rounded-full',
        running ? 'animate-pulsedot bg-primary' : 'bg-primary-tint-strong',
      )}
    />
  );
}

/** The running time from the server's clock (`useElapsedText`), `receivedAt` being when the
 * list arrived. */
function Timer({ visit, receivedAt }: { visit: LiveVisitRef; receivedAt: number }) {
  const elapsed = useElapsedText(visit, receivedAt);
  return (
    <span dir="ltr" className="font-mono text-[12.5px] leading-none font-semibold tabular-nums">
      {elapsed}
    </span>
  );
}

/**
 * The header's live-visit pill (workspace spec §Global shell): how a visit is recovered from
 * anywhere. `GET /visits/live?mine=true` — visits the caller is the dentist of or started (W18)
 * — polled every 30 s and on focus. One visit is a link with a pulsing dot, the patient's first
 * name and the running time; several are a menu. The visit whose workspace is open is left
 * out: its own header already shows it. Nothing without `visit:write` (the front desk, W18).
 */
export function LiveVisitPill() {
  const canWrite = usePermission('visit:write');
  const live = useQuery({
    ...liveVisitsQuery({ mine: true }),
    enabled: canWrite,
    refetchInterval: LIVE_PILL_REFETCH_MS,
    refetchOnWindowFocus: 'always',
  });
  const openVisitId = useParams({ strict: false, select: (params) => params.visitId });
  const visits = live.data?.filter((visit) => visit.id !== openVisitId) ?? [];

  if (!canWrite || visits.length === 0) return null;
  const [only] = visits;
  if (only && visits.length === 1) {
    return <SinglePill visit={only} receivedAt={live.dataUpdatedAt} />;
  }
  return <PillMenu visits={visits} receivedAt={live.dataUpdatedAt} />;
}

function SinglePill({ visit, receivedAt }: { visit: LiveVisitRef; receivedAt: number }) {
  const { t } = useTranslation('shell');
  const running = visit.status === 'in_progress';
  return (
    <Link to="/visits/$visitId" params={{ visitId: visit.id }} className={PILL}>
      <Dot running={running} />
      <span className="text-[12.5px] leading-none font-medium whitespace-nowrap">
        {t(running ? 'livePill.inProgress' : 'livePill.paused', {
          name: firstName(visit.patientName),
        })}
      </span>
      <Timer visit={visit} receivedAt={receivedAt} />
    </Link>
  );
}

function PillMenu({ visits, receivedAt }: { visits: LiveVisitRef[]; receivedAt: number }) {
  const { t } = useTranslation('shell');
  const navigate = useNavigate();
  const running = visits.some((visit) => visit.status === 'in_progress');
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" className={PILL}>
          <Dot running={running} />
          <span className="text-[12.5px] leading-none font-medium whitespace-nowrap">
            {t('livePill.several', { count: visits.length })}
          </span>
          <svg
            aria-hidden
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="flex-none"
          >
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-[270px]">
        {visits.map((visit) => (
          <MenuItem
            key={visit.id}
            onSelect={() => {
              void navigate({ to: '/visits/$visitId', params: { visitId: visit.id } });
            }}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Dot running={visit.status === 'in_progress'} />
              <span className="min-w-0 truncate">{visit.patientName}</span>
            </span>
            <span className="ms-3 flex flex-none items-center gap-2 text-primary">
              <span className="text-[11.5px] font-normal text-ink-muted">
                {t(visit.status === 'in_progress' ? 'livePill.running' : 'livePill.pausedShort')}
              </span>
              <Timer visit={visit} receivedAt={receivedAt} />
            </span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
