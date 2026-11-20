import type { WaitlistOpening } from '@dcm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BoardIcon } from '@/components/board/board-icons';
import { BoardMore } from '@/components/board/board-more';
import { HUE_BUTTON, useRowArrival } from '@/components/board/board-kit';
import { TodayCard } from '@/components/board/today-card';
import { Button } from '@/components/ui/button';
import { InfoMark } from '@/components/ui/info-mark';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatCalendarDate, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { invalidateSchedule } from '../scheduling-api';
import { leaveOpen, openingsQuery } from './waitlist-api';
import { useWaitlistPanels } from './waitlist-context';
import { toFill } from './waitlist-words';

const ROWS = 5;

/**
 * Today's **Openings to fill** (C3), for the current branch: soonest first, five rows and then
 * *View all*. Absent with nothing to show. Polled like the board, so other computers see it.
 */
export function TodayOpeningsLane({ branchId }: { branchId: string }) {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const canFill = usePermission('appointment:write_all');
  const openings = useQuery(openingsQuery(branchId, canFill));
  const { openFill } = useWaitlistPanels();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [all, setAll] = useState(false);
  const left = useMutation({
    mutationFn: (opening: WaitlistOpening) => leaveOpen(opening.id, opening.startsAt),
    onSuccess: () => invalidateSchedule(queryClient),
    onError: (error) => {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    },
  });
  const rows = toFill(openings.data?.openings ?? []);
  if (!canFill || !session?.tenant || rows.length === 0) return null;
  const clock = { timeZone: session.tenant.timeZone, locale: i18n.language };
  const shown = all ? rows : rows.slice(0, ROWS);
  return (
    <TodayCard
      id="openings"
      hue="sky"
      icon={<BoardIcon name="opening" />}
      title={t('waitlist.lane')}
      count={rows.length}
      extra={<InfoMark about={t('waitlist.lane')}>{t('waitlist.openingInfo')}</InfoMark>}
      span={1}
    >
      <ul className="m-0 list-none p-0">
        {shown.map((opening) => (
          <OpeningRow
            key={`${opening.id}@${opening.startsAt}`}
            opening={opening}
            clock={clock}
            onFill={() => {
              openFill?.(opening.id, opening.startsAt);
            }}
            onLeaveOpen={() => {
              left.mutate(opening);
            }}
          />
        ))}
      </ul>
      {!all && rows.length > ROWS ? (
        <BoardMore
          total={rows.length}
          onShowAll={() => {
            setAll(true);
          }}
        />
      ) : null}
    </TodayCard>
  );
}

function OpeningRow({
  opening,
  clock,
  onFill,
  onLeaveOpen,
}: {
  opening: WaitlistOpening;
  clock: { timeZone: string; locale: string };
  onFill: () => void;
  onLeaveOpen: () => void;
}) {
  const { t, i18n } = useTranslation('scheduling');
  const arrival = useRowArrival();
  return (
    <li
      className={cn(
        'flex items-center gap-3 border-t border-row-divider px-3.5 py-2.5 first:border-t-0',
        arrival,
      )}
    >
      <span className="min-w-0 flex-1 truncate text-[13px]">
        <span className="font-medium">
          {formatCalendarDate(opening.date, i18n.language)} · {formatTime(opening.startsAt, clock)}–
          {formatTime(opening.endsAt, clock)}
        </span>
        <span className="text-ink-secondary"> · {opening.dentistName}</span>
      </span>
      <span className="flex-none text-[12px] text-ink-muted">
        {t('waitlist.nFit', { count: opening.fitCount })}
      </span>
      <Button size="sm" variant="primary" className={HUE_BUTTON} onClick={onFill}>
        {t('waitlist.fill')}
      </Button>
      <Menu>
        <MenuTrigger asChild>
          <Button size="sm" variant="secondary" aria-label={t('today.more')}>
            {'⋯'}
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem onSelect={onLeaveOpen}>{t('waitlist.leaveOpen')}</MenuItem>
        </MenuContent>
      </Menu>
    </li>
  );
}
