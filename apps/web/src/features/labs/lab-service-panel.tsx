import type { Lab, LabService, Session } from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { Field, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { MoneyInput } from '@/features/billing/money-input';
import { parseAmount } from '@/lib/amount';
import { apiErrorMessage } from '@/lib/api-error-message';
import { createLabService, invalidateLabs, updateLabService } from './labs-api';

type Tenant = NonNullable<Session['tenant']>;

/**
 * Add a service to a lab's price list, or edit one (Part A): its name, price and, when it differs
 * from the lab's standard, its turnaround. A changed price applies to new orders only; orders
 * already placed keep theirs.
 */
export function LabServicePanel({
  lab,
  service,
  tenant,
  onClose,
}: {
  lab: Lab;
  /** Undefined: *Add service*. */
  service?: LabService;
  tenant: Tenant;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['labs', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(service?.name ?? '');
  const [priceText, setPriceText] = useState(service?.price ?? '');
  const [daysText, setDaysText] = useState(
    service?.turnaroundDays == null ? '' : String(service.turnaroundDays),
  );
  const [dirty, setDirty] = useState(false);
  const [tried, setTried] = useState(false);
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const price = parseAmount(priceText, locale);
  const days = daysText.trim() === '' ? null : Number(daysText);
  const problems = {
    name: name.trim() === '' ? t('labs:form.problems.required') : undefined,
    price:
      price === ''
        ? t('labs:form.problems.required')
        : price === null || price.startsWith('-')
          ? t('labs:form.problems.amount')
          : undefined,
    days:
      days !== null && !(Number.isInteger(days) && days >= 1 && days <= 365)
        ? t('labs:form.problems.days')
        : undefined,
  };
  const ready = Object.values(problems).every((problem) => problem === undefined);
  const shown = (field: keyof typeof problems) =>
    tried || left.has(field) ? problems[field] : undefined;
  const touch = () => {
    setDirty(true);
    setError(undefined);
  };

  const close = () => {
    if (saving) return;
    if (!dirty) {
      onClose();
      return;
    }
    confirm({
      title: t('common:discardTitle'),
      body: t('common:discardBody'),
      okLabel: t('common:discardLeave'),
      cancelLabel: t('common:keepEditing'),
      tone: 'warn',
      onConfirm: onClose,
    });
  };

  const save = async () => {
    setTried(true);
    if (!ready || saving || price === null || price === '') return;
    setSaving(true);
    try {
      if (service) {
        await updateLabService(lab.id, service.id, {
          ...(name.trim() !== service.name ? { name: name.trim() } : {}),
          ...(price !== service.price ? { price } : {}),
          ...(days !== service.turnaroundDays ? { turnaroundDays: days } : {}),
        });
      } else {
        await createLabService(lab.id, { name: name.trim(), price, turnaroundDays: days });
      }
      await invalidateLabs(queryClient);
      toast(service ? t('labs:service.saved') : t('labs:service.added'), { tone: 'success' });
      onClose();
    } catch (failure) {
      setError(apiErrorMessage(failure, i18n));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        aria-hidden
        onClick={close}
        className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
      />
      <RightPanel
        modal
        eyebrow={lab.name}
        title={service ? t('labs:service.editTitle') : t('labs:service.newTitle')}
        dirty={dirty}
        onClose={close}
        closeDisabled={saving}
        initialFocus="field"
        className="fixed inset-y-0 end-0 z-40 max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
        footer={
          <>
            <Button disabled={saving} onClick={close}>
              {t('common:cancel')}
            </Button>
            <Button variant="primary" busy={saving} onClick={() => void save()}>
              {service ? t('labs:service.save') : t('labs:service.add')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 text-[13px]">
          <Field label={t('labs:service.name')} error={shown('name')}>
            {(props) => (
              <TextInput
                {...props}
                value={name}
                maxLength={80}
                placeholder={t('labs:service.namePlaceholder')}
                onBlur={() => {
                  setLeft((current) => new Set(current).add('name'));
                }}
                onChange={(event) => {
                  setName(event.target.value);
                  touch();
                }}
              />
            )}
          </Field>
          <Field
            label={t('labs:service.price')}
            hint={service ? t('labs:lab.priceHint') : undefined}
            error={shown('price')}
          >
            {(props) => (
              <MoneyInput
                {...props}
                value={priceText}
                onBlur={() => {
                  setLeft((current) => new Set(current).add('price'));
                }}
                onChange={(value) => {
                  setPriceText(value);
                  touch();
                }}
                currency={tenant.currency}
                locale={locale}
              />
            )}
          </Field>
          <Field
            label={t('labs:service.turnaround')}
            hint={t('labs:dialogs.optional')}
            error={shown('days')}
          >
            {(props) => (
              <div className="relative">
                <TextInput
                  {...props}
                  inputMode="numeric"
                  value={daysText}
                  placeholder={String(lab.turnaroundDays)}
                  onBlur={() => {
                    setLeft((current) => new Set(current).add('days'));
                  }}
                  onChange={(event) => {
                    setDaysText(event.target.value);
                    touch();
                  }}
                  className="pe-14"
                />
                <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-[12.5px] text-ink-muted">
                  {t('labs:lab.daysSuffix')}
                </span>
              </div>
            )}
          </Field>
          <p className="-mt-2 m-0 text-[12px] text-ink-muted">
            {t('labs:service.turnaroundHint', { count: lab.turnaroundDays })}
          </p>
          {error && (
            <p role="alert" className="m-0 text-[12.5px] font-medium text-danger">
              {error}
            </p>
          )}
        </div>
      </RightPanel>
    </>
  );
}
