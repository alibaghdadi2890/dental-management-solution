import { PASSWORD_MIN_LENGTH, PRACTITIONER_TYPES, type StaffUser } from '@dcm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ChipCheckboxGroup } from '@/components/ui/chip-checkbox';
import { useConfirm } from '@/components/ui/confirm-context';
import { Eyebrow, Field, Select, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import {
  branchesQuery,
  createUser,
  platformKeys,
  rolesQuery,
  updateUser,
} from '@/features/platform/platform-api';
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

type PanelError = UserFieldError | 'emailTaken' | 'lastOwner';
type TextField = 'displayName' | 'email' | 'title' | 'phone';

/** New / Edit user right panel (spec: platform admin portal, Users tab). */
export function UserPanel({
  tenantId,
  user,
  onClose,
}: {
  tenantId: string;
  /** Absent for a new user. */
  user?: StaffUser | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const roles = useQuery(rolesQuery(tenantId));
  const branches = useQuery(branchesQuery(tenantId));
  const [initial] = useState<UserForm>(() => (user ? userFormFrom(user) : EMPTY_USER_FORM));
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<UserField, PanelError>>>({});
  const [failure, setFailure] = useState<string>();
  const dirty = isUserFormDirty(form, initial);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!user) {
        const result = toCreateRequest(form);
        if (!result.ok) return result;
        await createUser(tenantId, result.request);
        return { ok: true as const };
      }
      const result = toPatchRequest(form, initial);
      if (!result.ok) return result;
      if (result.patch) await updateUser(tenantId, user.id, result.patch);
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
        queryClient.invalidateQueries({ queryKey: platformKeys.tenants }),
      ]);
      toast(user ? t('users.panel.saved') : t('users.panel.created'));
      onClose();
    } catch (error) {
      const code = error instanceof ApiError ? error.code : undefined;
      if (code === 'user.email_taken') setErrors({ email: 'emailTaken' });
      else if (code === 'user.last_owner') setErrors({ roleKeys: 'lastOwner' });
      else setFailure(t('users.panel.failed'));
    }
  };

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
                if (type) edit('practitionerType', type);
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
      {text('phone', t('users.fields.phone'), { type: 'tel' })}

      <Eyebrow className="mt-2">{t('users.panel.sections.access')}</Eyebrow>
      <ChipCheckboxGroup
        label={t('users.fields.roles')}
        options={(roles.data ?? []).map((role) => ({ value: role.key, label: role.name }))}
        selected={form.roleKeys}
        onToggle={(key) => {
          edit('roleKeys', toggle(form.roleKeys, key));
        }}
        error={message(errors.roleKeys)}
      />
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
    </RightPanel>
  );
}
