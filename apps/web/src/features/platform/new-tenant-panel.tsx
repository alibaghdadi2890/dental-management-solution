import { LOCALES, PASSWORD_MIN_LENGTH } from '@dcm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { Eyebrow, Field, Select, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { ApiError } from '@/lib/api';
import { CountrySelect } from './country-select';
import {
  EMPTY_NEW_TENANT,
  editNewTenant,
  type FieldError,
  isDirty,
  type NewTenantField,
  toProvisionRequest,
} from './new-tenant-form';
import { platformKeys, provisionTenant } from './platform-api';
import { CURRENCIES, TIME_ZONES } from './tenant-options';
import { generateTemporaryPassword } from './temporary-password';

type Errors = Partial<Record<NewTenantField, FieldError | 'slugTaken' | 'emailTaken'>>;

/** New tenant right panel: Clinic · First branch · Owner account (spec: platform admin portal). */
export function NewTenantPanel({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_NEW_TENANT);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string>();

  const mutation = useMutation({ mutationFn: provisionTenant });

  const set = (field: NewTenantField) => (value: string) => {
    setForm((current) => editNewTenant(current, field, value));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const message = (error: Errors[NewTenantField]) =>
    error === undefined
      ? undefined
      : error === 'password'
        ? t('newTenant.errors.password', { count: PASSWORD_MIN_LENGTH })
        : t(`newTenant.errors.${error}`);

  const close = () => {
    if (!isDirty(form)) {
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
    const result = toProvisionRequest(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setFailure(undefined);
    try {
      const tenant = await mutation.mutateAsync(result.request);
      await queryClient.invalidateQueries({ queryKey: platformKeys.tenants });
      toast(t('newTenant.created'), {
        actionLabel: t('newTenant.open'),
        onAction: () => {
          void navigate({ to: '/admin/tenants/$tenantId', params: { tenantId: tenant.id } });
        },
      });
      onCreated();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'tenant.slug_taken') {
        setErrors({ slug: 'slugTaken' });
      } else if (error instanceof ApiError && error.code === 'user.email_taken') {
        setErrors({ ownerEmail: 'emailTaken' });
      } else {
        setFailure(t('newTenant.errors.generic'));
      }
    }
  };

  const text = (
    field: NewTenantField,
    label: string,
    options: { hint?: string; type?: string; mono?: boolean } = {},
  ) => (
    <Field label={label} hint={options.hint} error={message(errors[field])}>
      {(props) => (
        <TextInput
          {...props}
          type={options.type ?? 'text'}
          value={form[field]}
          onChange={(event) => {
            set(field)(event.target.value);
          }}
          className={options.mono ? 'font-mono' : undefined}
        />
      )}
    </Field>
  );

  return (
    <RightPanel
      eyebrow={t('newTenant.eyebrow')}
      title={t('newTenant.title')}
      dirty={isDirty(form)}
      onClose={close}
      initialFocus="field"
      footer={
        <>
          <Button onClick={close}>{t('common:cancel')}</Button>
          <Button variant="primary" busy={mutation.isPending} onClick={() => void submit()}>
            {mutation.isPending ? t('newTenant.busy') : t('newTenant.submit')}
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
      <Eyebrow>{t('newTenant.sections.clinic')}</Eyebrow>
      {text('name', t('newTenant.fields.name'))}
      {text('slug', t('newTenant.fields.slug'), {
        hint: t('newTenant.fields.slugHint'),
        mono: true,
      })}
      <Field label={t('newTenant.fields.timeZone')}>
        {(props) => (
          <Select
            {...props}
            value={form.timeZone}
            onChange={(event) => {
              set('timeZone')(event.target.value);
            }}
          >
            {TIME_ZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('newTenant.fields.currency')}>
          {(props) => (
            <Select
              {...props}
              value={form.currency}
              onChange={(event) => {
                set('currency')(event.target.value);
              }}
            >
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('newTenant.fields.locale')}>
          {(props) => (
            <Select
              {...props}
              value={form.locale}
              onChange={(event) => {
                set('locale')(event.target.value);
              }}
            >
              {LOCALES.map((locale) => (
                <option key={locale} value={locale}>
                  {t(`locales.${locale}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <CountrySelect
        label={t('newTenant.fields.country')}
        value={form.country}
        onChange={set('country')}
      />

      <Eyebrow className="mt-2">{t('newTenant.sections.branch')}</Eyebrow>
      {text('branchName', t('newTenant.fields.branchName'))}
      {text('address', t('newTenant.fields.address'))}
      {text('phone', t('newTenant.fields.phone'), { type: 'tel', mono: true })}

      <Eyebrow className="mt-2">{t('newTenant.sections.owner')}</Eyebrow>
      {text('ownerName', t('newTenant.fields.ownerName'))}
      {text('ownerEmail', t('newTenant.fields.ownerEmail'), { type: 'email' })}
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
                set('password')(event.target.value);
              }}
              className="font-mono"
            />
            <Button
              variant="outline"
              onClick={() => {
                set('password')(generateTemporaryPassword());
              }}
            >
              {t('newTenant.fields.generate')}
            </Button>
          </div>
        )}
      </Field>
    </RightPanel>
  );
}
