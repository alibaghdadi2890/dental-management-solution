import type { StaffUser, Tenant } from '@dcm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast-context';
import {
  catalogKeys,
  diagnosesQuery,
  seedDefaultCatalog,
  servicesQuery,
} from '@/features/clinical/catalog/catalog-api';
import { branchesQuery, roomsQuery, usersQuery } from '@/features/platform/platform-api';
import { formatDate } from '@/lib/format';
import { useRoleLabel } from '@/features/users/role-label';

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

/**
 * Shown while both catalogs are empty (tenants provisioned before feature 2, or a failed seeding
 * after provisioning): seeds the default template once, then disappears (C3).
 */
function SeedCatalogCard({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation(['admin', 'common']);
  const toast = useToast();
  const queryClient = useQueryClient();
  const seed = useMutation({
    mutationFn: () => seedDefaultCatalog(tenantId),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      toast(t('detail.overview.seeded', result));
    },
    onError: (error) => {
      toast(
        t('detail.overview.seedFailed', {
          reason: error.message || t('common:unexpected'),
        }),
        { tone: 'danger' },
      );
    },
  });
  return (
    <div className="col-span-full flex flex-wrap items-center gap-3 rounded-xl border border-warning-border bg-warning-bg px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-snug font-semibold text-warning">
          {t('detail.overview.catalogEmpty')}
        </div>
        <div className="mt-0.5 text-[12.5px] leading-snug text-ink-secondary">
          {t('detail.overview.catalogEmptyHint')}
        </div>
      </div>
      <Button
        variant="primary"
        busy={seed.isPending}
        onClick={() => {
          seed.mutate();
        }}
      >
        {t('detail.overview.seed')}
      </Button>
    </div>
  );
}

export function OverviewTab({ tenant }: { tenant: Tenant }) {
  const { t, i18n } = useTranslation('admin');
  const roleLabel = useRoleLabel();
  const branches = useQuery(branchesQuery(tenant.id));
  const rooms = useQuery(roomsQuery(tenant.id));
  const services = useQuery(servicesQuery(tenant.id));
  const diagnoses = useQuery(diagnosesQuery(tenant.id));
  const users = useQuery({
    ...usersQuery(tenant.id),
    select: (all) => all.filter((user) => user.active),
  });

  const activeOf = (items: { active: boolean }[] | undefined) =>
    items
      ? t('detail.overview.activeOf', {
          active: items.filter((item) => item.active).length,
          total: items.length,
        })
      : undefined;

  /** "1 Owner · 2 Dentist", in role order. */
  const byRole = (active: StaffUser[] | undefined) => {
    if (!active) return undefined;
    const counts = new Map<string, number>();
    for (const role of active.flatMap((user) => user.roles)) {
      const name = roleLabel(role);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => `${count} ${name}`).join(' · ');
  };
  const owners = users.data
    ?.filter((user) => user.roles.some((role) => role.key === 'owner'))
    .map((user) => user.displayName);

  const catalogEmpty = services.data?.length === 0 && diagnoses.data?.length === 0;

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
      {catalogEmpty && <SeedCatalogCard tenantId={tenant.id} />}
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
      <Card
        label={t('detail.overview.services')}
        value={services.data?.length ?? pending}
        detail={activeOf(services.data)}
      />
      <Card
        label={t('detail.overview.diagnoses')}
        value={diagnoses.data?.length ?? pending}
        detail={activeOf(diagnoses.data)}
      />
      <Card
        label={t('detail.overview.users')}
        value={users.data?.length ?? pending}
        detail={byRole(users.data)}
      />
      <Card
        label={t('detail.overview.owner')}
        value={<span className="font-sans text-base">{owners?.join(', ') || pending}</span>}
      />
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
