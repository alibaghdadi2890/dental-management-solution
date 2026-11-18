import { LAB_DELIVERY_METHODS, type Lab, type LabDeliveryMethod } from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { Eyebrow, Field, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast-context';
import { apiErrorMessage } from '@/lib/api-error-message';
import { cn } from '@/lib/utils';
import { createLab, invalidateLabs, updateLab } from './labs-api';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINK = /^https?:\/\/\S+$/i;

/**
 * Add a lab, or edit one (Part A): who it is and how to reach it, how cases go to it, its
 * standard turnaround and a note; an existing lab can be made inactive. Errors show once a field
 * is left or Save is pressed; closing with changes asks first. A new lab opens on its own page,
 * where its services and account are.
 */
export function LabFormPanel({
  lab,
  onClose,
  onSaved,
}: {
  /** Undefined: *Add a lab*. */
  lab?: Lab;
  onClose: () => void;
  onSaved?: (lab: Lab) => void;
}) {
  const { t, i18n } = useTranslation(['labs', 'common']);
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(lab?.name ?? '');
  const [contactPerson, setContactPerson] = useState(lab?.contactPerson ?? '');
  const [phone, setPhone] = useState(lab?.phone ?? '');
  const [email, setEmail] = useState(lab?.email ?? '');
  const [address, setAddress] = useState(lab?.address ?? '');
  const [methods, setMethods] = useState<LabDeliveryMethod[]>(lab?.deliveryMethods ?? ['courier']);
  const [portalUrl, setPortalUrl] = useState(lab?.portalUrl ?? '');
  const [turnaround, setTurnaround] = useState(String(lab?.turnaroundDays ?? 7));
  const [note, setNote] = useState(lab?.note ?? '');
  const [active, setActive] = useState(lab?.active ?? true);
  const [dirty, setDirty] = useState(false);
  const [tried, setTried] = useState(false);
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const noteId = useId();
  const methodsId = useId();

  const days = Number(turnaround);
  const problems = {
    name: name.trim() === '' ? t('labs:form.problems.required') : undefined,
    email:
      email.trim() !== '' && !EMAIL.test(email.trim()) ? t('labs:form.problems.email') : undefined,
    portalUrl:
      portalUrl.trim() !== '' && !LINK.test(portalUrl.trim())
        ? t('labs:form.problems.url')
        : undefined,
    turnaround:
      turnaround.trim() === ''
        ? t('labs:form.problems.required')
        : !Number.isInteger(days) || days < 1 || days > 365
          ? t('labs:form.problems.days')
          : undefined,
    methods: methods.length === 0 ? t('labs:form.problems.methods') : undefined,
  };
  const ready = Object.values(problems).every((problem) => problem === undefined);
  const shown = (field: keyof typeof problems) =>
    tried || left.has(field) ? problems[field] : undefined;
  const leave = (field: string) => () => {
    setLeft((current) => new Set(current).add(field));
  };
  const change =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
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

  const text = (value: string) => (value.trim() === '' ? null : value.trim());
  const save = async () => {
    setTried(true);
    if (!ready || saving) return;
    setSaving(true);
    const body = {
      name: name.trim(),
      contactPerson: text(contactPerson),
      phone: text(phone),
      email: text(email),
      address: text(address),
      deliveryMethods: methods,
      portalUrl: text(portalUrl),
      turnaroundDays: days,
      note: text(note),
    };
    try {
      const saved = lab ? await updateLab(lab.id, { ...body, active }) : await createLab(body);
      await invalidateLabs(queryClient);
      toast(lab ? t('labs:lab.saved') : t('labs:lab.created', { name: saved.name }), {
        tone: 'success',
      });
      onSaved?.(saved);
      onClose();
    } catch (failure) {
      setError(apiErrorMessage(failure, i18n));
    } finally {
      setSaving(false);
    }
  };

  const input = (
    field: string,
    label: string,
    value: string,
    set: (value: string) => void,
    extra: {
      dir?: 'ltr';
      hint?: string;
      error?: string | undefined;
      type?: string;
      inputMode?: 'numeric' | 'tel' | 'email' | 'url';
      maxLength?: number;
      suffix?: ReactNode;
    } = {},
  ) => (
    <Field label={label} hint={extra.hint} error={extra.error}>
      {(props) => (
        <div className="relative">
          <TextInput
            {...props}
            dir={extra.dir}
            type={extra.type}
            inputMode={extra.inputMode}
            maxLength={extra.maxLength}
            value={value}
            onBlur={leave(field)}
            onChange={(event) => {
              change(set)(event.target.value);
            }}
            className={cn(extra.suffix !== undefined && 'pe-14')}
          />
          {extra.suffix !== undefined && (
            <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-[12.5px] text-ink-muted">
              {extra.suffix}
            </span>
          )}
        </div>
      )}
    </Field>
  );
  const optional = t('labs:dialogs.optional');

  return (
    <>
      <div
        aria-hidden
        onClick={close}
        className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
      />
      <RightPanel
        modal
        eyebrow={t('labs:lab.eyebrow')}
        title={lab ? t('labs:lab.editTitle', { name: lab.name }) : t('labs:lab.newTitle')}
        dirty={dirty}
        onClose={close}
        closeDisabled={saving}
        initialFocus="field"
        className="fixed inset-y-0 end-0 z-40 w-[520px] max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
        footer={
          <>
            <Button disabled={saving} onClick={close}>
              {t('common:cancel')}
            </Button>
            <Button variant="primary" busy={saving} onClick={() => void save()}>
              {lab ? t('labs:lab.save') : t('labs:lab.add')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-6 text-[13px]">
          <section className="flex flex-col gap-3">
            {input('name', t('labs:lab.name'), name, setName, {
              error: shown('name'),
              maxLength: 80,
            })}
            {input('turnaround', t('labs:lab.turnaround'), turnaround, setTurnaround, {
              inputMode: 'numeric',
              error: shown('turnaround'),
              hint: t('labs:lab.turnaroundHint'),
              suffix: t('labs:lab.daysSuffix'),
            })}
          </section>

          <section className="flex flex-col gap-3">
            <Eyebrow>{t('labs:lab.contact')}</Eyebrow>
            <div className="grid grid-cols-2 gap-3">
              {input(
                'contactPerson',
                t('labs:lab.contactPerson'),
                contactPerson,
                setContactPerson,
                {
                  hint: optional,
                  maxLength: 120,
                },
              )}
              {input('phone', t('labs:lab.phone'), phone, setPhone, {
                dir: 'ltr',
                type: 'tel',
                inputMode: 'tel',
                hint: optional,
                maxLength: 40,
              })}
            </div>
            {input('email', t('labs:lab.email'), email, setEmail, {
              dir: 'ltr',
              type: 'email',
              inputMode: 'email',
              hint: optional,
              error: shown('email'),
              maxLength: 200,
            })}
            {input('address', t('labs:lab.address'), address, setAddress, {
              hint: optional,
              maxLength: 300,
            })}
          </section>

          <section className="flex flex-col gap-3">
            <Eyebrow>{t('labs:lab.cases')}</Eyebrow>
            <div>
              <div id={methodsId} className="mb-1.5 text-[12.5px] leading-none font-medium">
                {t('labs:lab.deliveryMethods')}
              </div>
              <div role="group" aria-labelledby={methodsId} className="flex flex-wrap gap-1.5">
                {LAB_DELIVERY_METHODS.map((method) => {
                  const on = methods.includes(method);
                  return (
                    <button
                      key={method}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => {
                        change(setMethods)(
                          on ? methods.filter((value) => value !== method) : [...methods, method],
                        );
                      }}
                      className={cn(
                        'h-[30px] cursor-pointer rounded-[15px] border px-3 text-[12px] font-medium',
                        on
                          ? 'border-primary bg-primary-tint text-primary'
                          : 'border-border-control bg-surface hover:border-ink',
                      )}
                    >
                      {t(`labs:delivery.${method}`)}
                    </button>
                  );
                })}
              </div>
              {(tried || dirty) && problems.methods && (
                <span className="mt-[5px] block text-xs leading-tight font-medium text-danger">
                  {problems.methods}
                </span>
              )}
            </div>
            {input('portalUrl', t('labs:lab.portalUrl'), portalUrl, setPortalUrl, {
              dir: 'ltr',
              type: 'url',
              inputMode: 'url',
              hint: optional,
              error: shown('portalUrl'),
              maxLength: 500,
            })}
          </section>

          <section className="flex flex-col gap-1.5">
            <label
              htmlFor={noteId}
              className="flex justify-between text-[12.5px] leading-none font-medium"
            >
              <span>{t('labs:lab.note')}</span>
              <span className="font-normal text-ink-muted">{optional}</span>
            </label>
            <textarea
              id={noteId}
              value={note}
              rows={3}
              maxLength={1000}
              placeholder={t('labs:lab.notePlaceholder')}
              onChange={(event) => {
                change(setNote)(event.target.value);
              }}
              className="block w-full resize-y rounded-lg border border-border-control bg-surface px-[11px] py-2 text-[13px] leading-[1.5] text-ink"
            />
          </section>

          {lab && (
            <section className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
              <Switch
                checked={active}
                onCheckedChange={change(setActive)}
                label={t('labs:lab.active')}
              />
              <div>
                <div className="font-medium">{t('labs:lab.active')}</div>
                <div className="text-[12px] text-ink-muted">{t('labs:lab.activeHint')}</div>
              </div>
            </section>
          )}

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
