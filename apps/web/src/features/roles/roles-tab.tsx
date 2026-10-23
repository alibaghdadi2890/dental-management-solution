import type { GrantablePermission, Permission } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { Field, TextInput } from '@/components/ui/field';
import { ErrorState, Pill, SkeletonRows } from '@/components/ui/list';
import { InPanelSlot } from '@/components/ui/panel-slot';
import { SaveBar } from '@/components/ui/save-bar';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast-context';
import { useRoleLabel } from '@/features/users/role-label';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CapabilityMatrix } from './capability-matrix';
import { NewRolePanel } from './new-role-panel';
import type { RoleRow, RolesSource } from './roles-source';
import { useAccessRights } from './use-access-rights';

interface Draft {
  name: string;
  description: string;
  permissions: GrantablePermission[];
}

const grantable = (role: RoleRow): GrantablePermission[] => {
  const permissions: readonly Permission[] = role.permissions;
  return permissions.filter(
    (permission): permission is GrantablePermission => permission !== 'platform:admin',
  );
};

const draftOf = (role: RoleRow): Draft => ({
  name: role.name,
  description: role.description ?? '',
  permissions: grantable(role),
});

/** How many switches and fields differ from the role as saved: the save bar's count. */
function changesIn(draft: Draft, role: RoleRow): number {
  const saved = new Set(grantable(role));
  const now = new Set(draft.permissions);
  let count = 0;
  for (const permission of now) if (!saved.has(permission)) count += 1;
  for (const permission of saved) if (!now.has(permission)) count += 1;
  if (!role.system && draft.name.trim() !== role.name) count += 1;
  if (!role.system && draft.description.trim() !== (role.description ?? '')) count += 1;
  return count;
}

/**
 * Settings › Roles (ADR-0055): the clinic's roles on the left (System or Custom, how many hold
 * each, a custom role's Active switch, **New role**), the selected one's capability matrix on the
 * right with the catalog's sticky save bar. System roles but `owner` are edited and reset to
 * their default; custom ones are renamed and switched off, never deleted. Edits need
 * `role:write`; the API refuses a permission the editor does not hold, inline on its switch. On
 * the platform's default roles (ADR-0056) there are no holders and no reset: they are the default.
 */
export function RolesTab({ source }: { source: RolesSource }) {
  const { t } = useTranslation(['roles', 'common']);
  const roleLabel = useRoleLabel();
  const access = useAccessRights();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: source.queryKey, queryFn: source.list, staleTime: Infinity });
  const platform = source.kind === 'platform';
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<ReadonlyMap<GrantablePermission, string>>(new Map());
  const [failure, setFailure] = useState<string>();
  const [activeError, setActiveError] = useState<{ id: string; message: string }>();
  const [creating, setCreating] = useState(false);

  const list = roles.data ?? [];
  const selected = list.find((role) => role.id === selectedId) ?? list[0];
  const current = selected && draft ? draft : selected ? draftOf(selected) : undefined;
  const changes = selected && draft ? changesIn(draft, selected) : 0;
  const locked = selected?.system === true && selected.key === 'owner';
  const editable = access.write && !locked;

  const refresh = () =>
    Promise.all(source.refresh.map((queryKey) => queryClient.invalidateQueries({ queryKey })));

  const reset = () => {
    setDraft(undefined);
    setErrors(new Map());
    setFailure(undefined);
  };

  /** Leaving a role with unsaved changes asks first, like the catalog. */
  const select = (role: RoleRow) => {
    if (role.id === selected?.id) return;
    const go = () => {
      reset();
      setSelectedId(role.id);
    };
    if (changes === 0) {
      go();
      return;
    }
    confirm({
      title: t('common:discardTitle'),
      body: t('common:discardBody'),
      okLabel: t('common:discard'),
      cancelLabel: t('common:keepEditing'),
      tone: 'warn',
      onConfirm: go,
    });
  };

  const failWith = (error: unknown) => {
    const code = error instanceof ApiError ? error.code : undefined;
    const permission = error instanceof ApiError ? error.problem.permission : undefined;
    const granted = current?.permissions.find((candidate) => candidate === permission);
    if (code === 'role.cannot_grant' && granted) {
      setErrors(new Map([[granted, t('errors.cannotGrant')]]));
    } else if (code === 'role.self_lockout') setFailure(t('errors.selfLockout'));
    else if (code === 'role.owner_locked') setFailure(t('errors.ownerLocked'));
    else if (code === 'role.not_allowed') setFailure(t('errors.notAllowed'));
    else setFailure(t('common:unexpected'));
  };

  const save = async () => {
    if (!selected || !draft) return;
    setSaving(true);
    setErrors(new Map());
    setFailure(undefined);
    try {
      await source.update(selected.id, {
        permissions: draft.permissions,
        ...(selected.system
          ? {}
          : { name: draft.name.trim(), description: draft.description.trim() || null }),
      });
      await refresh();
      reset();
      toast(t('roles.saved'));
    } catch (error) {
      failWith(error);
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = (role: RoleRow) => {
    confirm({
      title: t('roles.resetTitle', { role: roleLabel(role) }),
      body: t('roles.resetBody'),
      okLabel: t('roles.resetConfirm'),
      tone: 'warn',
      onConfirm: async () => {
        try {
          await source.action(role.id, 'reset');
          await refresh();
          reset();
          toast(t('roles.reset'));
        } catch (error) {
          failWith(error);
        }
      },
    });
  };

  const setActive = async (role: RoleRow, active: boolean) => {
    setActiveError(undefined);
    try {
      await source.action(role.id, active ? 'reactivate' : 'deactivate');
      await refresh();
      toast(t(active ? 'roles.switchedOn' : 'roles.switchedOff'));
    } catch (error) {
      const holders = error instanceof ApiError ? error.problem.holders : undefined;
      setActiveError({
        id: role.id,
        message:
          holders === undefined
            ? t('common:unexpected')
            : t('roles.hasHolders', { count: holders }),
      });
    }
  };

  if (roles.isPending) {
    return <SkeletonRows columns="1fr 2fr" rows={4} label={t('roles.list')} />;
  }
  if (roles.isError) {
    return (
      <ErrorState
        title={t('roles.loadFailed')}
        body={t('roles.loadFailedBody')}
        requestId={roles.error instanceof ApiError ? roles.error.requestId : undefined}
        error={roles.error}
        onRetry={() => void roles.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-[18px] pb-6">
      <section
        aria-label={t('roles.list')}
        className="w-full max-w-[320px] flex-none overflow-hidden rounded-xl border border-border bg-surface"
      >
        <ul className="m-0 list-none p-0">
          {list.map((role) => {
            const on = role.id === selected?.id;
            return (
              <li
                key={role.id}
                className={cn(
                  'border-b border-row-divider last:border-b-0',
                  on ? 'bg-selected' : 'bg-surface',
                  !role.active && 'text-ink-muted',
                )}
              >
                <div className="flex items-center gap-2.5 px-3.5 py-3">
                  <button
                    type="button"
                    aria-current={on ? 'true' : undefined}
                    onClick={() => {
                      select(role);
                    }}
                    className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 text-start"
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] leading-tight font-semibold">
                        {roleLabel(role)}
                      </span>
                      <Pill tone={role.system ? 'neutral' : 'indigo'}>
                        {t(role.system ? 'roles.system' : 'roles.custom')}
                      </Pill>
                      {!role.active && <Pill tone="warning">{t('roles.inactive')}</Pill>}
                    </span>
                    {'holders' in role && (
                      <span className="text-[12px] leading-none text-ink-tertiary">
                        {t('roles.holders', { count: role.holders })}
                      </span>
                    )}
                  </button>
                  {!role.system && access.write && (
                    <Switch
                      checked={role.active}
                      label={t('roles.activeLabel', { role: roleLabel(role) })}
                      onCheckedChange={(checked) => {
                        void setActive(role, checked);
                      }}
                    />
                  )}
                </div>
                {activeError?.id === role.id && (
                  <p role="alert" className="m-0 px-3.5 pb-3 text-[12px] leading-snug text-danger">
                    {activeError.message}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {access.write && (
          <div className="border-t border-border bg-faint px-3.5 py-3">
            <Button
              variant="primary"
              onClick={() => {
                setCreating(true);
              }}
            >
              {t('roles.newRole')}
            </Button>
          </div>
        )}
      </section>

      {selected && current && (
        <section
          aria-label={roleLabel(selected)}
          className="flex min-w-[320px] flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface"
        >
          <div className="flex flex-col gap-4 px-[22px] py-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="m-0 text-[16px] leading-tight font-semibold">{t('roles.heading')}</h2>
              {selected.system && !locked && !platform && access.write && (
                <Button
                  className="ms-auto"
                  onClick={() => {
                    resetToDefault(selected);
                  }}
                >
                  {t('roles.resetToDefault')}
                </Button>
              )}
            </div>
            {locked && (
              <p className="m-0 text-[13px] leading-snug text-ink-secondary">
                {t('roles.ownerNote')}
              </p>
            )}
            {!access.write && !locked && (
              <p className="m-0 text-[13px] leading-snug text-ink-secondary">
                {t('roles.readOnly')}
              </p>
            )}
            {!selected.system && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('roles.name')}>
                  {(props) => (
                    <TextInput
                      {...props}
                      value={current.name}
                      readOnly={!editable}
                      onChange={(event) => {
                        setDraft({ ...current, name: event.target.value });
                      }}
                    />
                  )}
                </Field>
                <Field label={t('roles.description')}>
                  {(props) => (
                    <TextInput
                      {...props}
                      value={current.description}
                      readOnly={!editable}
                      onChange={(event) => {
                        setDraft({ ...current, description: event.target.value });
                      }}
                    />
                  )}
                </Field>
              </div>
            )}
            {failure && (
              <p
                role="alert"
                className="m-0 rounded-lg border border-danger-border bg-danger-bg px-3 py-2.5 text-[12.5px] leading-snug font-medium text-danger"
              >
                {failure}
              </p>
            )}
            <CapabilityMatrix
              value={current.permissions}
              readOnly={!editable}
              errors={errors}
              onChange={(permissions) => {
                setErrors(new Map());
                setDraft({ ...current, permissions });
              }}
            />
          </div>
          {changes > 0 && (
            <div className="sticky bottom-0">
              <SaveBar
                label={t('roles.unsaved', { count: changes })}
                saving={saving}
                error={current.name.trim() === '' ? t('roles.nameRequired') : undefined}
                onDiscard={reset}
                onSave={() => void save()}
              />
            </div>
          )}
        </section>
      )}

      {creating && (
        <InPanelSlot>
          <NewRolePanel
            source={source}
            roles={list}
            onClose={() => {
              setCreating(false);
            }}
            onCreated={(role) => {
              setCreating(false);
              reset();
              setSelectedId(role.id);
            }}
          />
        </InPanelSlot>
      )}
    </div>
  );
}
