import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { CardSkeleton } from '@/components/ui/card';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import {
  CHECKOUT_REFETCH_MS,
  IN_THE_CHAIR,
  useCheckoutQueue,
} from '@/features/clinical/checkout-queue';
import { PostVisitSummaryDialog } from '@/features/clinical/dialogs/post-visit-summary-dialog';
import { visitPageQuery } from '@/features/clinical/visits-list/visits-list-api';
import { formatCalendarDate, todayIn } from '@/lib/format';
import { ChairRow } from './chair-lane';
import { CheckoutCard } from './checkout-lane';

/** A lane of the board: its heading with the count, then the rows or what stands in for them. */
function Lane({
  title,
  count,
  framed = true,
  children,
}: {
  title: string;
  count: number | undefined;
  /** One bordered surface around the rows; off when each row is a card of its own. */
  framed?: boolean;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mb-6">
      <h2
        id={headingId}
        className="mb-2.5 text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal"
      >
        {count === undefined ? title : `${title} · ${String(count)}`}
      </h2>
      {framed ? (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">{children}</div>
      ) : (
        children
      )}
    </section>
  );
}

const Note = ({ children, alert = false }: { children: ReactNode; alert?: boolean }) => (
  <p
    {...(alert ? { role: 'alert' } : {})}
    className="m-0 px-[18px] py-5 text-[12.5px] leading-snug text-ink-muted"
  >
    {children}
  </p>
);

/**
 * The Today board (spec `2026-10-04-today-board-design.md`): the home of whoever collects.
 * **Ready for checkout** — today's visits of the branch that still owe, oldest first, each with
 * **Check out**, which opens the same checkout dialog the completer saw (the open visit is in the
 * URL) — and **In the chair**, the branch's live visits with their running time. Both poll every
 * 30 s. A visit paid in full leaves the lane; its dialog stays, showing it paid, until Done.
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
  const { data: session } = useSession();
  const canOpenVisits = usePermission('visit:write');
  const queue = useCheckoutQueue();
  // The patient of the open dialog, kept once their visit has left the queue (paid in full).
  const [opened, setOpened] = useState<{ id: string; name: string }>();
  const chair = useQuery({
    ...visitPageQuery(IN_THE_CHAIR, false),
    enabled: queue.enabled,
    refetchInterval: CHECKOUT_REFETCH_MS,
    refetchOnWindowFocus: 'always',
  });
  if (!session?.tenant) return null;
  const { timeZone } = session.tenant;
  const subtitle = [formatCalendarDate(todayIn(timeZone), locale), session.branch?.name]
    .filter(Boolean)
    .join(' · ');

  if (!queue.enabled) {
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

  const waitingOpen = queue.visits.find((visit) => visit.id === openVisitId);
  const open = waitingOpen
    ? { id: waitingOpen.id, name: waitingOpen.patient.fullName }
    : opened?.id === openVisitId
      ? opened
      : undefined;
  const inChair = [...(chair.data?.items ?? [])].reverse();

  let waiting: ReactNode;
  if (queue.loading) {
    waiting = (
      <div className="px-[18px] py-4">
        <CardSkeleton label={t('checkout.loading')} />
      </div>
    );
  } else if (queue.failed && queue.visits.length === 0) {
    waiting = <Note alert>{t('checkout.failed')}</Note>;
  } else if (queue.visits.length === 0) {
    waiting = <Note>{t('checkout.empty')}</Note>;
  } else {
    waiting = (
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {queue.visits.map((visit) => (
          <CheckoutCard
            key={visit.id}
            visit={visit}
            balance={queue.balanceOf(visit.id)}
            selected={visit.id === open?.id}
            timeZone={timeZone}
            locale={locale}
            onCheckout={() => {
              setOpened({ id: visit.id, name: visit.patient.fullName });
              onOpen(visit.id);
            }}
          />
        ))}
      </ul>
    );
  }

  let seated: ReactNode;
  if (chair.isPending) {
    seated = (
      <div className="px-[18px] py-4">
        <CardSkeleton label={t('chair.loading')} />
      </div>
    );
  } else if (chair.isError && inChair.length === 0) {
    seated = <Note alert>{t('chair.failed')}</Note>;
  } else if (inChair.length === 0) {
    seated = <Note>{t('chair.empty')}</Note>;
  } else {
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
        <Lane
          title={t('checkout.title')}
          count={queue.loading ? undefined : queue.visits.length}
          framed={queue.visits.length === 0}
        >
          {waiting}
        </Lane>
        <Lane title={t('chair.title')} count={chair.isPending ? undefined : inChair.length}>
          {seated}
        </Lane>
      </Page>
      {open && (
        <PostVisitSummaryDialog
          key={open.id}
          visitId={open.id}
          title={t('dialog.title', { name: open.name })}
          onClose={() => {
            onOpen(undefined);
          }}
        />
      )}
    </>
  );
}
