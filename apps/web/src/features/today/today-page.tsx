import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Band, Board } from '@/components/board/board';
import { BoardIcon } from '@/components/board/board-icons';
import { CARD_LINK } from '@/components/board/board-kit';
import { TodayCard } from '@/components/board/today-card';
import { Page } from '@/components/page';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import {
  CHECKOUT_REFETCH_MS,
  IN_THE_CHAIR,
  useCheckoutQueue,
} from '@/features/clinical/checkout-queue';
import { PostVisitSummaryDialog } from '@/features/clinical/dialogs/post-visit-summary-dialog';
import { TodayExpensesCard } from '@/features/expenses/today-expenses-card';
import { TodayLabLane } from '@/features/labs/today-lab-lane';
import {
  checkOutVisit,
  invalidateVisitData,
  visitPageQuery,
} from '@/features/clinical/visits-list/visits-list-api';
import { worklistQuery } from '@/features/scheduling/scheduling-api';
import { TodayStockCard } from '@/features/inventory/today-stock-card';
import {
  ComingUpCard,
  FollowUpsCard,
  NextUpCard,
  TodayScheduleCard,
  WaitingCard,
} from '@/features/scheduling/today-schedule';
import { TodayOpeningsLane } from '@/features/scheduling/waitlist/today-openings-lane';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatCalendarDate, todayIn } from '@/lib/format';
import { ChairRow } from './chair-lane';
import { CheckoutCard } from './checkout-lane';

const Note = ({ children, alert = false }: { children: ReactNode; alert?: boolean }) => (
  <p
    {...(alert ? { role: 'alert' } : {})}
    className="m-0 px-3.5 py-5 text-[12.5px] leading-snug text-ink-muted"
  >
    {children}
  </p>
);

const SKELETON = [
  ['waiting', 'col-span-5'],
  ['chair', 'col-span-4'],
  ['next', 'col-span-3'],
  ['schedule', 'col-span-8'],
  ['follow-ups', 'col-span-4'],
] as const;

/** The first load, before any card has come back: the board's shape in quiet blocks. */
function BoardSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="grid grid-cols-12 gap-3">
      {SKELETON.map(([key, span]) => (
        <span key={key} className={`${span} block h-28 animate-pulse rounded-xl bg-subtle`} />
      ))}
    </div>
  );
}

/** Every card the caller may see is empty: one calm line, and where to go instead. */
function AllClear({ canSeeSchedule }: { canSeeSchedule: boolean }) {
  const { t } = useTranslation('today');
  return (
    <p className="m-0 py-10 text-center text-[13px] leading-snug text-ink-secondary">
      {t('allClear')}{' '}
      {canSeeSchedule ? (
        <>
          <Link to="/schedule" className="font-medium text-primary hover:underline">
            {t('toSchedule')}
          </Link>
          {' · '}
        </>
      ) : null}
      <Link to="/patients" className="font-medium text-primary hover:underline">
        {t('toPatients')}
      </Link>
    </p>
  );
}

/**
 * The Today board (spec `2026-10-04-today-board-design.md`, laid out by
 * `2026-11-20-today-board-refresh-design.md`): three bands by urgency — Now, Today, Back office —
 * of cards in their hues, each absent while it has nothing to show, arriving with a bloom.
 * **Ready for checkout** — today's visits of the branch that still owe, oldest first, each with
 * **Check out**, which opens the same checkout dialog the completer saw (the open visit is in the
 * URL) — and **In the chair**, the branch's live visits with their running time. Both poll every
 * 30 s. A visit paid in full leaves the lane; its dialog stays, showing it paid, until Done.
 * **Done** on a visit still waiting closes its checkout without a payment (ADR-0033): the card
 * leaves the lane and the amount stays a receivable. `Esc` only closes the dialog. Whoever sees
 * expenses also has this month's expenses card (feature 17), and whoever sees lab work the Lab
 * work lane (feature 18).
 */
export function TodayPage({
  openVisitId,
  onOpen,
}: {
  openVisitId: string | undefined;
  onOpen: (visitId: string | undefined) => void;
}) {
  const { t, i18n } = useTranslation('today');
  const locale = i18n.resolvedLanguage ?? 'en';
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: session } = useSession();
  const canOpenVisits = usePermission('visit:write');
  // The chair lane is the caller's visits (their scope, ADR-0055); the checkout lane needs one
  // patient's money (`payment:read`), and checking out needs `payment:write`.
  const canSeeVisits = usePermission('visit:read');
  const canCheckOut = usePermission('payment:write');
  const canSeeSchedule = usePermission('appointment:read');
  // This month's expenses (feature 17, A5): its own permission, never salaries or payouts.
  const canSeeExpenses = usePermission('expense:read');
  const canSeeLab = usePermission('lab:read');
  // The Stock card (feature 20a, C2): exceptions only, for whoever sees stock.
  const canSeeStock = usePermission('inventory:read');
  const queue = useCheckoutQueue();
  // The patient of the open dialog, kept once their visit has left the queue (paid in full).
  const [opened, setOpened] = useState<{ id: string; name: string }>();
  const chair = useQuery({
    ...visitPageQuery(IN_THE_CHAIR, false),
    enabled: canSeeVisits,
    refetchInterval: CHECKOUT_REFETCH_MS,
    refetchOnWindowFocus: 'always',
  });
  const canWork = usePermission('appointment:write_all');
  const worklist = useQuery(worklistQuery(session?.branch?.id ?? '', canWork));
  // Pending until the lists are back, so the card goes at once and doesn't flash in again.
  const checkOut = useMutation({
    mutationFn: checkOutVisit,
    onSuccess: () => invalidateVisitData(queryClient),
    onError: (error) => {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    },
  });
  if (!session?.tenant) return null;
  const { timeZone } = session.tenant;
  const branch = session.branch;
  const subtitle = [formatCalendarDate(todayIn(timeZone), locale), session.branch?.name]
    .filter(Boolean)
    .join(' · ');

  if (
    !queue.enabled &&
    !canSeeVisits &&
    !canSeeSchedule &&
    !canSeeExpenses &&
    !canSeeLab &&
    !canSeeStock
  ) {
    return (
      <Page title={t('title')} subtitle={subtitle}>
        <p className="text-[13px] leading-snug text-ink-secondary">
          {t('noAccess')}{' '}
          <Link to="/patients" className="font-medium text-primary hover:underline">
            {t('toPatients')}
          </Link>
        </p>
      </Page>
    );
  }

  const waitingVisits = queue.visits.filter(
    (visit) => !(checkOut.isPending && visit.id === checkOut.variables),
  );
  const waitingOpen = waitingVisits.find((visit) => visit.id === openVisitId);
  const open = waitingOpen
    ? { id: waitingOpen.id, name: waitingOpen.patient.fullName }
    : opened?.id === openVisitId
      ? opened
      : undefined;
  const inChair = [...(chair.data?.items ?? [])].reverse();
  const awaitingVisits = new Set(worklist.data?.map((followUp) => followUp.sourceVisitId));

  let waiting: ReactNode = null;
  if (queue.failed && waitingVisits.length === 0) {
    waiting = <Note alert>{t('checkout.failed')}</Note>;
  } else if (!queue.loading && waitingVisits.length > 0) {
    waiting = (
      <ul className="m-0 list-none p-0">
        {waitingVisits.map((visit) => (
          <CheckoutCard
            key={visit.id}
            visit={visit}
            balance={queue.balanceOf(visit.id)}
            selected={visit.id === open?.id}
            timeZone={timeZone}
            locale={locale}
            canCheckOut={canCheckOut}
            followUpWaiting={awaitingVisits.has(visit.id)}
            onCheckout={() => {
              setOpened({ id: visit.id, name: visit.patient.fullName });
              onOpen(visit.id);
            }}
          />
        ))}
      </ul>
    );
  }

  let seated: ReactNode = null;
  if (chair.isError && inChair.length === 0) {
    seated = <Note alert>{t('chair.failed')}</Note>;
  } else if (inChair.length > 0) {
    seated = (
      <ul className="m-0 list-none p-0">
        {inChair.map((visit) => (
          <ChairRow
            key={visit.id}
            visit={visit}
            receivedAt={chair.dataUpdatedAt}
            canOpen={canOpenVisits}
          />
        ))}
      </ul>
    );
  }

  return (
    <>
      <Page title={t('title')} subtitle={subtitle}>
        <Board
          userId={session.user.id}
          loading={<BoardSkeleton label={t('loading')} />}
          empty={<AllClear canSeeSchedule={canSeeSchedule} />}
        >
          <Band label={t('bands.now')}>
            {branch ? <WaitingCard branchId={branch.id} /> : null}
            {canSeeVisits && seated ? (
              <TodayCard
                id="chair"
                hue="indigo"
                icon={<BoardIcon name="chair" />}
                title={t('chair.title')}
                link={(label) => (
                  <Link to="/visits" className={CARD_LINK}>
                    {label}
                  </Link>
                )}
                count={chair.isPending ? undefined : inChair.length}
                span={4}
              >
                {seated}
              </TodayCard>
            ) : null}
            {branch ? <NextUpCard branchId={branch.id} /> : null}
            {queue.enabled && waiting ? (
              <TodayCard
                id="checkout"
                hue="rose"
                icon={<BoardIcon name="checkout" />}
                title={t('checkout.title')}
                count={queue.loading ? undefined : waitingVisits.length}
                span={12}
              >
                {waiting}
              </TodayCard>
            ) : null}
          </Band>
          <Band label={t('bands.today')}>
            {branch ? <TodayScheduleCard branchId={branch.id} /> : null}
            {branch ? <FollowUpsCard branchId={branch.id} /> : null}
            {branch ? <TodayOpeningsLane branchId={branch.id} /> : null}
            {branch ? <ComingUpCard branchId={branch.id} /> : null}
          </Band>
          <Band label={t('bands.backOffice')}>
            {canSeeLab && branch ? (
              <TodayLabLane branchId={branch.id} tenant={session.tenant} />
            ) : null}
            {canSeeStock && branch ? <TodayStockCard branchId={branch.id} /> : null}
            {canSeeExpenses && <TodayExpensesCard session={session} />}
          </Band>
        </Board>
      </Page>
      {open && (
        <PostVisitSummaryDialog
          key={open.id}
          visitId={open.id}
          title={t('dialog.title', { name: open.name })}
          {...(waitingOpen
            ? {
                onDone: () => {
                  checkOut.mutate(open.id);
                },
              }
            : {})}
          onClose={() => {
            onOpen(undefined);
          }}
        />
      )}
    </>
  );
}
