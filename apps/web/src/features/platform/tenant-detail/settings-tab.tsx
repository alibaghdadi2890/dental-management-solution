import { LOCALES, type Tenant, type TenantSettingsPatch } from '@dcm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, Select, TextInput } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast-context';
import { CountrySelect } from '@/features/platform/country-select';
import { platformKeys, updateTenantSettings } from '@/features/platform/platform-api';
import { CURRENCIES, TIME_ZONES } from '@/features/platform/tenant-options';

type SettingsForm = Pick<Tenant, 'name' | 'timeZone' | 'currency' | 'locale' | 'country'>;

function changed(tenant: Tenant, form: SettingsForm): TenantSettingsPatch {
  const patch: TenantSettingsPatch = {};
  if (form.name.trim() !== tenant.name) patch.name = form.name.trim();
  if (form.timeZone !== tenant.timeZone) patch.timeZone = form.timeZone;
  if (form.currency !== tenant.currency) patch.currency = form.currency;
  if (form.locale !== tenant.locale) patch.locale = form.locale;
  if (form.country !== tenant.country) patch.country = form.country;
  return patch;
}

/** Name, time zone, currency, locale, country with the POC save-state indicator. */
export function SettingsTab({ tenant }: { tenant: Tenant }) {
  const { t } = useTranslation(['admin', 'common']);
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SettingsForm>(tenant);
  const [saved, setSaved] = useState(false);
  const patch = changed(tenant, form);
  const dirty = Object.keys(patch).length > 0;
  const mutation = useMutation({ mutationFn: () => updateTenantSettings(patch, tenant.id) });

  const set = (key: keyof SettingsForm) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    try {
      const updated = await mutation.mutateAsync();
      queryClient.setQueryData(platformKeys.tenant(tenant.id), updated);
      await queryClient.invalidateQueries({ queryKey: platformKeys.tenants });
      setForm(updated);
      setSaved(true);
      toast(t('settings.saved'));
    } catch {
      toast(t('settings.failed'), { tone: 'danger' });
    }
  };

  const state = mutation.isPending
    ? { dot: 'bg-ink-muted', label: t('common:saving') }
    : dirty
      ? { dot: 'bg-warning-dot', label: t('common:unsaved') }
      : saved
        ? { dot: 'bg-success', label: t('common:saved') }
        : null;

  return (
    <section className="max-w-[560px] rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-1 text-[15px] leading-tight font-semibold">{t('settings.title')}</h2>
      <p className="mb-4 text-[12.5px] leading-snug text-ink-tertiary">{t('settings.body')}</p>
      <div className="flex flex-col gap-3.5">
        <Field
          label={t('newTenant.fields.name')}
          error={form.name.trim() === '' ? t('newTenant.errors.required') : undefined}
        >
          {(props) => (
            <TextInput
              {...props}
              value={form.name}
              onChange={(event) => {
                set('name')(event.target.value);
              }}
            />
          )}
        </Field>
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
                {[...new Set([tenant.currency, ...CURRENCIES])].map((currency) => (
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
      </div>
      <div className="mt-5 flex items-center gap-3">
        {state && (
          <span
            role="status"
            className="flex items-center gap-2 text-[12.5px] font-medium text-ink-secondary"
          >
            <span className={`size-2 rounded-full ${state.dot}`} />
            {state.label}
          </span>
        )}
        <Button
          variant="primary"
          className="ms-auto"
          disabled={!dirty || form.name.trim() === ''}
          busy={mutation.isPending}
          onClick={() => void save()}
        >
          {t('common:save')}
        </Button>
      </div>
    </section>
  );
}
