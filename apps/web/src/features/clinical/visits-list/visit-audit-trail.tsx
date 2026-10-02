import type { AuditEntry } from '@dcm/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SHIMMER } from '@/components/ui/list';
import { formatDateTime, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { visitAuditQuery } from './visits-list-api';

const KNOWN_ACTIONS = [
  'visit.start',
  'visit.pause',
  'visit.resume',
  'visit.update',
  'visit.complete',
  'visit.amend',
  'visit.void',
] as const;

type KnownAction = (typeof KNOWN_ACTIONS)[number];

const isKnown = (action: string): action is KnownAction =>
  (KNOWN_ACTIONS as readonly string[]).includes(action);

/** `{ total }` of an amendment snapshot or a completion's after, if the entry carries one. */
function totalOf(side: unknown): string | null {
  const total = (side as { total?: unknown } | null)?.total;
  return typeof total === 'string' ? total : null;
}

function labelOf(
  entry: AuditEntry,
  t: TFunction<'visits'>,
  money: (amount: string) => string,
): string {
  if (!isKnown(entry.action)) return t('trail.actions.other');
  const reason = entry.reason ?? '';
  if (entry.action === 'visit.amend') {
    const before = totalOf(entry.before);
    const after = totalOf(entry.after);
    return before !== null && after !== null
      ? t('trail.actions.amendTotals', { reason, before: money(before), after: money(after) })
      : t('trail.actions.amend', { reason });
  }
  if (entry.action === 'visit.void') return t('trail.actions.void', { reason });
  if (entry.action === 'visit.complete') {
    const total = totalOf(entry.after);
    return total === null
      ? t('trail.actions.complete')
      : t('trail.actions.completeTotal', { total: money(total) });
  }
  return t(`trail.actions.${entry.action.slice('visit.'.length) as 'start'}`);
}

function actorOf(
  entry: AuditEntry,
  names: ReadonlyMap<string, string>,
  t: TFunction<'visits'>,
): string {
  if (entry.actorKind === 'job' || entry.actorKind === 'system') return t('trail.system');
  if (entry.actorPlatformAdmin) return t('trail.platformAdmin');
  const name = entry.actorUserId ? names.get(entry.actorUserId) : undefined;
  return name ?? t('trail.unknownUser');
}

/**
 * The detail panel's audit trail (D13: `audit:read` only): the visit's entries newest first, a
 * page at a time behind "Show more"; the latest dot filled. Amend and void read with their reason
 * (and an amendment with its before → after total).
 */
export function VisitAuditTrail({
  visitId,
  currency,
  names,
  timeZone,
  locale,
}: {
  visitId: string;
  currency: string;
  names: ReadonlyMap<string, string>;
  timeZone: string;
  locale: string;
}) {
  const { t } = useTranslation(['visits', 'common']);
  const headingId = useId();
  const audit = useInfiniteQuery(visitAuditQuery(visitId));
  const entries = audit.data?.pages.flatMap((page) => page.items) ?? [];
  const money = (amount: string) => formatMoney({ amount, currency }, locale);

  let body;
  if (audit.isPending) {
    body = (
      <div aria-busy="true" aria-label={t('trail.loading')} className="flex flex-col gap-2.5">
        <span className={cn('h-2.5 w-44', SHIMMER)} />
        <span className={cn('h-2.5 w-32', SHIMMER)} />
      </div>
    );
  } else if (audit.isError && entries.length === 0) {
    body = <p className="text-[12.5px] leading-snug text-ink-muted">{t('trail.failed')}</p>;
  } else {
    body = (
      <>
        <ol className="m-0 list-none border-s border-border p-0">
          {entries.map((entry, index) => (
            <li key={entry.id} className="relative ps-3.5 pb-3">
              <span
                aria-hidden
                className={cn(
                  'absolute -start-1 top-1 size-[7px] rounded-full border-[1.5px]',
                  index === 0 ? 'border-primary bg-primary' : 'border-border-strong bg-surface',
                )}
              />
              <div className="text-[12.5px] leading-[1.4] font-medium">
                {labelOf(entry, t, money)}
              </div>
              <div className="font-mono text-[11.5px] leading-[1.4] text-ink-muted">
                {t('trail.meta', {
                  at: formatDateTime(entry.occurredAt, { timeZone, locale }),
                  who: actorOf(entry, names, t),
                })}
              </div>
            </li>
          ))}
        </ol>
        {audit.isFetchNextPageError && !audit.isFetchingNextPage ? (
          <div role="alert" className="flex items-center gap-2">
            <span className="text-[12.5px] leading-snug text-ink-muted">
              {t('trail.moreFailed')}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void audit.fetchNextPage()}
              className="px-0"
            >
              {t('common:tryAgain')}
            </Button>
          </div>
        ) : (
          audit.hasNextPage && (
            <Button
              variant="ghost"
              size="sm"
              busy={audit.isFetchingNextPage}
              onClick={() => void audit.fetchNextPage()}
              className="self-start px-0"
            >
              {t('trail.more')}
            </Button>
          )
        )}
      </>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <h3 id={headingId} className="mb-2.5 text-[13px] leading-none font-semibold">
        {t('trail.title')}
      </h3>
      {body}
    </section>
  );
}
