import type { StaffUser } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import {
  EmptyState,
  ErrorState,
  Pill,
  SkeletonRows,
  TableCard,
  TableHead,
} from '@/components/ui/list';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { useToast } from '@/components/ui/toast-context';
import { platformKeys, setUserActive, usersQuery } from '@/features/platform/platform-api';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

const COLUMNS =
  'minmax(240px,1.6fr) minmax(110px,0.8fr) minmax(150px,1fr) minmax(130px,1fr) 104px 44px';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => /^\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

/** 28px circle avatar with initials (POC sidebar footer). */
function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="grid size-7 flex-none place-items-center rounded-full border border-primary-tint-border bg-primary-tint text-[11px] leading-none font-semibold text-primary"
    >
      {initials(name)}
    </span>
  );
}

export function UsersTab({
  tenantId,
  onNew,
  onEdit,
  onResetPassword,
}: {
  tenantId: string;
  onNew: () => void;
  onEdit: (user: StaffUser) => void;
  onResetPassword: (user: StaffUser) => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const users = useQuery(usersQuery(tenantId));

  const setActive = (user: StaffUser, active: boolean) => {
    confirm({
      title: t(active ? 'users.status.reactivateTitle' : 'users.status.deactivateTitle', {
        name: user.displayName,
      }),
      body: t(active ? 'users.status.reactivateBody' : 'users.status.deactivateBody'),
      okLabel: t(active ? 'users.status.reactivateOk' : 'users.status.deactivateOk'),
      tone: active ? 'warn' : 'danger',
      reasonLabel: t('status.reason'),
      onConfirm: async (reason) => {
        try {
          await setUserActive(tenantId, user.id, active, reason);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: platformKeys.users(tenantId) }),
            queryClient.invalidateQueries({ queryKey: platformKeys.tenants }),
          ]);
          toast(
            t(active ? 'users.status.reactivated' : 'users.status.deactivated', {
              name: user.displayName,
            }),
          );
        } catch (error) {
          const lastOwner = error instanceof ApiError && error.code === 'user.last_owner';
          toast(lastOwner ? t('users.errors.lastOwner') : t('common:unexpected'), {
            tone: 'danger',
          });
        }
      },
    });
  };

  const body = () => {
    if (users.isPending) {
      return <SkeletonRows columns={COLUMNS} rows={3} label={t('users.loading')} />;
    }
    if (users.isError) {
      return (
        <ErrorState
          title={t('users.error.title')}
          body={t('users.error.body')}
          requestId={users.error instanceof ApiError ? users.error.requestId : undefined}
          onRetry={() => void users.refetch()}
        />
      );
    }
    if (users.data.length === 0) {
      return (
        <EmptyState
          title={t('users.empty.title')}
          body={t('users.empty.body')}
          action={
            <Button variant="primary" onClick={onNew}>
              {t('users.new')}
            </Button>
          }
        />
      );
    }
    return users.data.map((user) => (
      <div
        key={user.id}
        role="row"
        className={cn(
          'grid min-h-14 items-center gap-2.5 border-t border-row-divider bg-surface px-3 py-1.5',
          !user.active && 'text-ink-muted',
        )}
        style={{ gridTemplateColumns: COLUMNS }}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar name={user.displayName} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] leading-tight font-medium">
              {user.displayName}
            </span>
            <span className="block truncate font-mono text-[11.5px] leading-snug text-ink-muted">
              {user.email}
            </span>
          </span>
        </span>
        <span className="truncate text-[12.5px] text-ink-secondary">
          {user.title ?? t(`users.practitionerTypes.${user.practitionerType}`)}
        </span>
        <span className="flex flex-wrap gap-1">
          {user.roles.map((role) => (
            <Pill key={role.key} tone="indigo">
              {role.name}
            </Pill>
          ))}
        </span>
        <span className="truncate text-[12.5px] text-ink-secondary">
          {user.branches.map((branch) => branch.name).join(', ')}
        </span>
        <span>
          <Pill tone={user.active ? 'success' : 'neutral'}>
            {t(user.active ? 'users.status.active' : 'users.status.inactive')}
          </Pill>
        </span>
        <span className="justify-self-end">
          <Menu>
            <MenuTrigger asChild>
              <IconButton aria-label={t('users.menu.label', { name: user.displayName })}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="3.5" cy="8" r="1.3" />
                  <circle cx="8" cy="8" r="1.3" />
                  <circle cx="12.5" cy="8" r="1.3" />
                </svg>
              </IconButton>
            </MenuTrigger>
            <MenuContent>
              <MenuItem
                onSelect={() => {
                  onEdit(user);
                }}
              >
                {t('users.menu.edit')}
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  onResetPassword(user);
                }}
              >
                {t('users.menu.resetPassword')}
              </MenuItem>
              {user.active ? (
                <MenuItem
                  tone="danger"
                  onSelect={() => {
                    setActive(user, false);
                  }}
                >
                  {t('users.menu.deactivate')}
                </MenuItem>
              ) : (
                <MenuItem
                  onSelect={() => {
                    setActive(user, true);
                  }}
                >
                  {t('users.menu.reactivate')}
                </MenuItem>
              )}
            </MenuContent>
          </Menu>
        </span>
      </div>
    ));
  };

  return (
    <>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="text-[12.5px] text-ink-tertiary">
          {users.data ? t('users.count', { count: users.data.length }) : ''}
        </span>
        <Button variant="primary" onClick={onNew}>
          {t('users.new')}
        </Button>
      </div>
      <TableCard minWidth={900}>
        <TableHead
          columns={COLUMNS}
          labels={[
            t('users.columns.name'),
            t('users.columns.title'),
            t('users.columns.roles'),
            t('users.columns.branches'),
            t('users.columns.status'),
            '',
          ]}
        />
        {body()}
      </TableCard>
    </>
  );
}
