import type { AuditEntry } from '@dcm/contracts';
import { DENTITION_STAGES } from '@dcm/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SHIMMER } from '@/components/ui/list';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { patientAuditQuery } from './patients-api';

/** The actions audited on a `patient` resource. (An opening balance is audited on the
 * `ledger_entry` it creates, so it isn't in a patient's timeline; the merge re-point is.) */
const KNOWN_ACTIONS = [
  'patient.create',
  'patient.update',
  'patient.archive',
  'patient.restore',
  'patient.merge',
  'patient.dentition',
  'ledger_entry.repoint',
  'contact.link',
  'contact.unlink',
  'contact.roles',
  'contact.merge',
] as const;

type KnownAction = (typeof KNOWN_ACTIONS)[number];

const isKnown = (action: string): action is KnownAction =>
  (KNOWN_ACTIONS as readonly string[]).includes(action);

const isDentitionStage = (value: unknown): value is (typeof DENTITION_STAGES)[number] =>
  typeof value === 'string' && (DENTITION_STAGES as readonly string[]).includes(value);

/**
 * `patient.dentition` (spec W14) has two labels, chosen from its `after.dentitionOverride`
 * (`null` back to auto, else the stage it was set to) rather than a single static string like
 * every other known action.
 */
function dentitionLabel(entry: AuditEntry, t: TFunction<'patients'>): string {
  const after = entry.after as { dentitionOverride?: unknown } | null;
  const stage = after?.dentitionOverride;
  return isDentitionStage(stage)
    ? t('activity.actions.patient.dentition.set', {
        stage: t(`activity.actions.patient.dentition.stage.${stage}`),
      })
    : t('activity.actions.patient.dentition.auto');
}

function actorOf(
  entry: AuditEntry,
  names: ReadonlyMap<string, string>,
  t: TFunction<'patients'>,
): string {
  if (entry.actorKind === 'job' || entry.actorKind === 'system') return t('activity.system');
  if (entry.actorPlatformAdmin) return t('activity.platformAdmin');
  const name = entry.actorUserId ? names.get(entry.actorUserId) : undefined;
  if (entry.actorKind === 'agent') {
    return name ? t('activity.viaAssistant', { name }) : t('activity.assistant');
  }
  return name ?? t('activity.unknownUser');
}

/**
 * The quick view's activity (design Q10: shown only with `audit:read`): the patient's audit
 * entries, newest first as `GET /audit` returns them, a page at a time behind "Show more". A
 * failed "Show more" keeps the entries already shown and offers a retry in its place; the full
 * error only replaces the list when there is nothing to show. Actors
 * are named from the staff list; jobs and the system read "System", a platform admin "Platform
 * admin".
 */
export function ActivityTimeline({
  patientId,
  names,
  timeZone,
  locale,
}: {
  patientId: string;
  names: ReadonlyMap<string, string>;
  timeZone: string;
  locale: string;
}) {
  const { t } = useTranslation(['patients', 'common']);
  const headingId = useId();
  const audit = useInfiniteQuery(patientAuditQuery(patientId));
  const entries = audit.data?.pages.flatMap((page) => page.items) ?? [];

  let body;
  if (audit.isPending) {
    body = (
      <div aria-busy="true" aria-label={t('activity.loading')} className="flex flex-col gap-2.5">
        <span className={cn('h-2.5 w-44', SHIMMER)} />
        <span className={cn('h-2.5 w-32', SHIMMER)} />
      </div>
    );
  } else if (audit.isError && entries.length === 0) {
    body = <p className="text-[12.5px] leading-snug text-ink-muted">{t('activity.failed')}</p>;
  } else if (entries.length === 0) {
    body = <p className="text-[12.5px] leading-snug text-ink-muted">{t('activity.empty')}</p>;
  } else {
    body = (
      <>
        <ol className="m-0 list-none border-s border-border p-0">
          {entries.map((entry) => (
            <li key={entry.id} className="relative ps-3.5 pb-3">
              <span
                aria-hidden
                className="absolute -start-1 top-1 size-[7px] rounded-full border-[1.5px] border-border-strong bg-surface"
              />
              <div className="text-[12.5px] leading-[1.4] font-medium">
                {isKnown(entry.action)
                  ? entry.action === 'patient.dentition'
                    ? dentitionLabel(entry, t)
                    : t(`activity.actions.${entry.action}`)
                  : t('activity.actions.other')}
              </div>
              <div className="font-mono text-[11.5px] leading-[1.4] text-ink-muted">
                {t('activity.meta', {
                  at: formatDateTime(entry.occurredAt, { timeZone, locale }),
                  who: actorOf(entry, names, t),
                })}
              </div>
              {entry.reason && (
                <div className="mt-0.5 text-xs leading-[1.4] text-ink-secondary">
                  {t('activity.reason', { reason: entry.reason })}
                </div>
              )}
            </li>
          ))}
        </ol>
        {audit.isFetchNextPageError && !audit.isFetchingNextPage ? (
          <div role="alert" className="flex items-center gap-2">
            <span className="text-[12.5px] leading-snug text-ink-muted">
              {t('activity.moreFailed')}
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
              {t('activity.more')}
            </Button>
          )
        )}
      </>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <h3 id={headingId} className="mb-2.5 text-[13px] leading-none font-semibold">
        {t('activity.title')}
      </h3>
      {body}
    </section>
  );
}
