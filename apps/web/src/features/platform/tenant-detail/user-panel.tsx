import {
  type GrantablePermission,
  PASSWORD_MIN_LENGTH,
  PRACTITIONER_TYPES,
  type StaffUser,
} from '@dcm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ChipCheckboxGroup } from '@/components/ui/chip-checkbox';
import { useConfirm } from '@/components/ui/confirm-context';
import { Eyebrow, Field, Select, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast-context';
import {
  branchesQuery,
  createUser,
  platformKeys,
  rolesQuery,
  setUserGrants,
  updateUser,
} from '@/features/platform/platform-api';
import { CapabilityMatrix } from '@/features/roles/capability-matrix';
import { useAccessRights } from '@/features/roles/use-access-rights';
import { choiceOnTypeChange } from '@/features/platform/specialty-choice';
import { SpecialtyFields } from '@/features/platform/specialty-fields';
import { generateTemporaryPassword } from '@/features/platform/temporary-password';
import { ApiError } from '@/lib/api';
import {
  EMPTY_USER_FORM,
  isUserFormDirty,
  toCreateRequest,
  toggle,
  toPatchRequest,
  type UserField,
  type UserFieldError,
  type UserForm,
  userFormFrom,
} from './user-form';
import { useRoleLabel } from '@/features/users/role-label';

type PanelError = UserFieldError | 'emailTaken' | 'lastOwner';
type TextField = 'displayName' | 'email' | 'title' | 'phone';
export type PanelTab = 'profile' | 'access';

const sameSet = (a: readonly string[], b: readonly string[]) =>
  [...a].sort().join() === [...b].sort().join();

/**
 * New / Edit user right panel (spec: platform admin portal, Users tab; Settings › Staff,
 * ADR-0055). Tabs **Profile · Access** for whoever sees access (`role:read`): Access holds the
 * roles and the person's additional permissions, saved with the profile by the one Save.
 */
export function UserPanel({
  tenantId,
  user,
  initialTab = 'profile',
  onClose,
}: {
  tenantId: string;
  /** Absent for a new user. */
  user?: StaffUser | undefined;
  /** The tab it opens on: **Access** from the row menu's Access & permissions. */
  initialTab?: PanelTab;
  onClose: () => void;
}) {
  const { t } = useTranslation(['admin', 'common', 'roles']);
  const access = useAccessRights();
  const tabsId = useId();
  const [tab, setTab] = useState<PanelTab>(initialTab);
  const [initialGrants] = useState<GrantablePermission[]>(() => user?.grants ?? []);
  const [grants, setGrants] = useState<GrantablePermission[]>(initialGrants);
  const [grantErrors, setGrantErrors] = useState<ReadonlyMap<GrantablePermission, string>>(
    new Map(),
  );
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const roles = useQuery(rolesQuery(tenantId));
  const roleLabel = useRoleLabel();
  const branches = useQuery(branchesQuery(tenantId));
  const [initial] = useState<UserForm>(() => (user ? userFormFrom(user) : EMPTY_USER_FORM));
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<UserField, PanelError>>>({});
  const [failure, setFailure] = useState<string>();
  const grantsDirty = !sameSet(grants, initialGrants);
  const dirty = isUserFormDirty(form, initial) || grantsDirty;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!user) {
        const result = toCreateRequest(form);
        if (!result.ok) return result;
        const created = await createUser(tenantId, result.request);
        if (grants.length > 0) {
          // The user exists now: a refused grant must not leave the panel creating them again.
          try {
            await setUserGrants(tenantId, created.id, { permissions: grants });
          } catch {
            return { ok: true as const, grantsRefused: true };
          }
        }
        return { ok: true as const };
      }
      const result = toPatchRequest(form, initial);
      if (!result.ok) return result;
      if (result.patch) await updateUser(tenantId, user.id, result.patch);
      if (grantsDirty) await setUserGrants(tenantId, user.id, { permissions: grants });
      return { ok: true as const };
    },
  });

  const edit = <TField extends UserField>(field: TField, value: UserForm[TField]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const message = (error: PanelError | undefined) =>
    error === undefined ? undefined : t(`users.errors.${error}`, { count: PASSWORD_MIN_LENGTH });

  const close = () => {
    if (!dirty) {
      onClose();
      return;
    }
    confirm({
      title: t('common:discardTitle'),
      body: t('common:discardBody'),
      okLabel: t('common:discardLeave'),
      cancelLabel: t('common:keepEditing'),
      tone: 'danger',
      onConfirm: onClose,
    });
  };

  const submit = async () => {
    setFailure(undefined);
    try {
      const result = await mutation.mutateAsync();
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: platformKeys.users(tenantId) }),
        queryClient.invalidateQueries({ queryKey: platformKeys.roles(tenantId) }),
        queryClient.invalidateQueries({ queryKey: platformKeys.tenants }),
        queryClient.invalidateQueries({ queryKey: ['users'] }),
      ]);
      if ('grantsRefused' in result) {
        toast(t('roles:errors.cannotGrant'), { tone: 'danger' });
      } else {
        toast(user ? t('users.panel.saved') : t('users.panel.created'));
      }
      onClose();
    } catch (error) {
      const code = error instanceof ApiError ? error.code : undefined;
      const permission = error instanceof ApiError ? error.problem.permission : undefined;
      if (code === 'user.email_taken') setErrors({ email: 'emailTaken' });
      else if (code === 'user.last_owner') setErrors({ roleKeys: 'lastOwner' });
      else if (code === 'user.specialty_required') setErrors({ specialties: 'specialties' });
      else if (code === 'role.cannot_grant' && permission === 'owner') {
        setTab('access');
        setFailure(t('roles:errors.cannotGrantOwner'));
      } else if (code === 'role.cannot_grant') {
        // On the switch when it is one of the person's grants, else about their roles.
        setTab('access');
        const grant = grants.find((candidate) => candidate === permission);
        if (grant) setGrantErrors(new Map([[grant, t('roles:errors.cannotGrant')]]));
        else setFailure(t('roles:errors.cannotGrant'));
      } else if (code === 'role.cannot_manage') {
        setFailure(t('roles:errors.cannotManage'));
      } else if (code === 'role.self_lockout') {
        setTab('access');
        setFailure(t('roles:errors.selfLockout'));
      } else setFailure(t('users.panel.failed'));
    }
  };

  // What the selected roles already give: on and locked in the matrix, "from {Role}".
  const fromRoles = new Map<GrantablePermission, string>();
  for (const role of roles.data ?? []) {
    if (!form.roleKeys.includes(role.key)) continue;
    for (const permission of role.permissions) {
      if (permission === 'platform:admin' || fromRoles.has(permission)) continue;
      fromRoles.set(permission, t('roles:matrix.fromRole', { role: roleLabel(role) }));
    }
  }
  // A custom role switched off is not offered; one the person still holds stays removable.
  const roleOptions = (roles.data ?? [])
    .filter((role) => role.active || initial.roleKeys.includes(role.key))
    .map((role) => ({ value: role.key, label: roleLabel(role) }));
  const roleChips = (
    <ChipCheckboxGroup
      label={t('users.fields.roles')}
      options={roleOptions}
      selected={form.roleKeys}
      onToggle={(key) => {
        edit('roleKeys', toggle(form.roleKeys, key));
      }}
      error={message(errors.roleKeys)}
      // Roles are assigned with the profile (`PATCH /users/:id`, `user:write`) and `role:write`.
      disabled={!access.write || !access.manageStaff}
    />
  );

  const text = (field: TextField, label: string, options: { type?: string } = {}) => (
    <Field label={label} error={message(errors[field])}>
      {(props) => (
        <TextInput
          {...props}
          type={options.type ?? 'text'}
          value={form[field]}
          disabled={field === 'email' && user !== undefined}
          onChange={(event) => {
            edit(field, event.target.value);
          }}
          className={field === 'phone' ? 'font-mono' : undefined}
        />
      )}
    </Field>
  );

  // Active branches, plus inactive ones the user still holds so they can be removed.
  const branchOptions = (branches.data ?? [])
    .filter((branch) => branch.active || initial.branchIds.includes(branch.id))
    .map((branch) => ({ value: branch.id, label: branch.name }));

  return (
    <RightPanel
      eyebrow={t(user ? 'users.panel.editEyebrow' : 'users.panel.newEyebrow')}
      title={user ? user.displayName : t('users.panel.newTitle')}
      dirty={dirty}
      onClose={close}
      initialFocus="field"
      footer={
        <>
          <Button onClick={close}>{t('common:cancel')}</Button>
          <Button
            variant="primary"
            busy={mutation.isPending}
            disabled={user !== undefined && !dirty}
            onClick={() => void submit()}
          >
            {t(user ? 'users.panel.save' : 'users.panel.create')}
          </Button>
        </>
      }
    >
      {failure && (
        <div
          role="alert"
          className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2.5 text-[12.5px] leading-[1.45] font-medium text-danger"
        >
          {failure}
        </div>
      )}
      {access.read && (
        <Tabs
          idBase={tabsId}
          label={t('roles:access.tab')}
          tabs={[
            { key: 'profile', label: t('roles:access.profileTab') },
            { key: 'access', label: t('roles:access.tab') },
          ]}
          active={tab}
          onChange={setTab}
          className="-mt-1 mb-1 border-b border-border"
        />
      )}
      {tab === 'profile' || !access.read ? (
        <TabPanel idBase={tabsId} tabKey="profile" className="flex flex-col gap-4 outline-none">
          {/* Profiles are staff management (`user:write`); access is on the next tab. */}
          <fieldset
            disabled={!access.manageStaff}
            className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
          >
            <Eyebrow>{t('users.panel.sections.person')}</Eyebrow>
            {text('displayName', t('users.fields.displayName'))}
            {text('email', t('users.fields.email'), { type: 'email' })}
            <div className="grid grid-cols-2 gap-3">
              {text('title', t('users.fields.title'))}
              <Field label={t('users.fields.practitionerType')}>
                {(props) => (
                  <Select
                    {...props}
                    value={form.practitionerType}
                    onChange={(event) => {
                      const type = PRACTITIONER_TYPES.find((value) => value === event.target.value);
                      if (!type) return;
                      edit('practitionerType', type);
                      edit('specialties', choiceOnTypeChange(type, form.specialties));
                    }}
                  >
                    {PRACTITIONER_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`users.practitionerTypes.${type}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            {form.practitionerType === 'dentist' && (
              <SpecialtyFields
                choice={form.specialties}
                onChange={(choice) => {
                  edit('specialties', choice);
                }}
                error={message(errors.specialties)}
              />
            )}
            {text('phone', t('users.fields.phone'), { type: 'tel' })}

            <Eyebrow className="mt-2">{t('users.panel.sections.access')}</Eyebrow>
            {!access.read && roleChips}
            <ChipCheckboxGroup
              label={t('users.fields.branches')}
              options={branchOptions}
              selected={form.branchIds}
              onToggle={(id) => {
                edit('branchIds', toggle(form.branchIds, id));
              }}
              error={message(errors.branchIds)}
            />

            {!user && (
              <Field
                label={t('newTenant.fields.password')}
                hint={t('newTenant.fields.passwordHint')}
                error={message(errors.password)}
              >
                {(props) => (
                  <div className="flex gap-2">
                    <TextInput
                      {...props}
                      value={form.password}
                      autoComplete="off"
                      onChange={(event) => {
                        edit('password', event.target.value);
                      }}
                      className="font-mono"
                    />
                    <Button
                      variant="outline"
                      onClick={() => {
                        edit('password', generateTemporaryPassword());
                      }}
                    >
                      {t('newTenant.fields.generate')}
                    </Button>
                  </div>
                )}
              </Field>
            )}
          </fieldset>
        </TabPanel>
      ) : (
        <TabPanel idBase={tabsId} tabKey="access" className="flex flex-col gap-4 outline-none">
          {roleChips}
          <div>
            <Eyebrow>{t('roles:access.additional')}</Eyebrow>
            <p className="m-0 mt-1 mb-3 text-[12.5px] leading-snug text-ink-tertiary">
              {access.write ? t('roles:access.additionalHint') : t('roles:access.readOnly')}
            </p>
            <CapabilityMatrix
              value={grants}
              locked={fromRoles}
              readOnly={!access.write}
              errors={grantErrors}
              onChange={(next) => {
                setGrants(next);
                setGrantErrors(new Map());
              }}
            />
          </div>
        </TabPanel>
      )}
    </RightPanel>
  );
}
