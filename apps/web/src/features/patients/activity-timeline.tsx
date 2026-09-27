import type { AuditEntry } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { SHIMMER } from '@/components/ui/list';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { patientAuditQuery } from './patients-api';

const KNOWN_ACTIONS = [
  'patient.create',
  'patient.update',
  'patient.archive',
  'patient.restore',
  'patient.merge',
  'ledger_entry.create',
  'ledger_entry.repoint',
] as const;

type KnownAction = (typeof KNOWN_ACTIONS)[number];

const isKnown = (action: string): action is KnownAction =>
  (KNOWN_ACTIONS as readonly string[]).includes(action);

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
 * entries, newest first as `GET /audit` returns them — first page only. Actors are named from the
 * staff list; jobs and the system read "System", a platform admin "Platform admin".
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
  const { t } = useTranslation('patients');
  const headingId = useId();
  const audit = useQuery(patientAuditQuery(patientId));

  let body;
  if (audit.isPending) {
    body = (
      <div aria-busy="true" aria-label={t('activity.loading')} className="flex flex-col gap-2.5">
        <span className={cn('h-2.5 w-44', SHIMMER)} />
        <span className={cn('h-2.5 w-32', SHIMMER)} />
      </div>
    );
  } else if (audit.isError) {
    body = <p className="text-[12.5px] leading-snug text-ink-muted">{t('activity.failed')}</p>;
  } else if (audit.data.items.length === 0) {
    body = <p className="text-[12.5px] leading-snug text-ink-muted">{t('activity.empty')}</p>;
  } else {
    body = (
      <ol className="m-0 list-none border-s border-border p-0">
        {audit.data.items.map((entry) => (
          <li key={entry.id} className="relative ps-3.5 pb-3">
            <span
              aria-hidden
              className="absolute -start-1 top-1 size-[7px] rounded-full border-[1.5px] border-border-strong bg-surface"
            />
            <div className="text-[12.5px] leading-[1.4] font-medium">
              {isKnown(entry.action)
                ? t(`activity.actions.${entry.action}`)
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
    );
  }

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="mb-2.5 text-[13px] leading-none font-semibold">
        {t('activity.title')}
      </h3>
      {body}
    </section>
  );
}
