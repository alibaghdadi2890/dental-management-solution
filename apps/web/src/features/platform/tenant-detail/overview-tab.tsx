import type { Tenant } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { branchesQuery, roomsQuery, tenantsQuery } from '@/features/platform/platform-api';
import { formatDate } from '@/lib/format';

function Card({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: string | undefined;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3.5">
      <div className="mb-2 text-[11.5px] leading-none font-medium tracking-[0.05em] text-ink-muted uppercase">
        {label}
      </div>
      <div className="font-mono text-[22px] leading-tight font-semibold tabular-nums">{value}</div>
      {detail && <div className="mt-1 text-[12.5px] leading-snug text-ink-tertiary">{detail}</div>}
    </div>
  );
}

const pending = '—';

export function OverviewTab({ tenant }: { tenant: Tenant }) {
  const { t, i18n } = useTranslation('admin');
  const branches = useQuery(branchesQuery(tenant.id));
  const rooms = useQuery(roomsQuery(tenant.id));
  const listed = useQuery({
    ...tenantsQuery(),
    select: (all) => all.find((row) => row.id === tenant.id),
  });

  const activeOf = (items: { active: boolean }[] | undefined) =>
    items
      ? t('detail.overview.activeOf', {
          active: items.filter((item) => item.active).length,
          total: items.length,
        })
      : undefined;

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
      <Card
        label={t('detail.overview.branches')}
        value={branches.data?.length ?? pending}
        detail={activeOf(branches.data)}
      />
      <Card
        label={t('detail.overview.rooms')}
        value={rooms.data?.length ?? pending}
        detail={activeOf(rooms.data)}
      />
      <Card label={t('detail.overview.users')} value={listed.data?.userCount ?? pending} />
      <Card
        label={t('detail.overview.created')}
        value={
          <span className="text-base">
            {formatDate(tenant.createdAt, {
              timeZone: tenant.timeZone,
              locale: i18n.resolvedLanguage ?? 'en',
            })}
          </span>
        }
      />
    </div>
  );
}
