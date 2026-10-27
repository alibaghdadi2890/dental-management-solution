import {
  AGREEMENT_PRESETS,
  COMPONENT_KINDS,
  type ComponentKind,
  type RateOverride,
  type Session,
  VISIT_TYPES,
} from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Eyebrow, Field, Select, TextInput } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { MoneyInput } from '@/features/billing/money-input';
import { servicesQuery } from '@/features/clinical/catalog/catalog-api';
import { dateInputOrder, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type AgreementDraft, type DraftField, draftProblems, presetDraft } from './agreement-form';
import { Segmented } from './segmented';

type Tenant = NonNullable<Session['tenant']>;

const NOTE_MAX = 500;
/** Agreements may start or end years ahead; the date field's calendar allows it. */
const FAR_FUTURE = '2099-12-31';

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-[12.5px] leading-snug font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-snug text-ink-muted">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} label={label} />
    </div>
  );
}

function Section({
  title,
  addable,
  on,
  onToggle,
  children,
}: {
  title: string;
  addable: boolean;
  on: boolean;
  onToggle: (on: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation('compensation');
  return (
    <section className="rounded-lg border border-border px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 text-[13px] font-semibold">{title}</h3>
        {addable && (
          <Switch checked={on} onCheckedChange={onToggle} label={t('form.add', { name: title })} />
        )}
      </div>
      {on && <div className="mt-3 flex flex-col gap-3">{children}</div>}
    </section>
  );
}

/**
 * The agreement form (prompt §1): preset tiles, the start date, each component's fields — Custom
 * shows all four, each with an Add switch — whether the dentist sees their statement, and a note.
 * Problems show once the owner has tried to save (`showProblems`); `dateError` is the server's
 * answer about the dates (an overlap, a closed month).
 */
export function AgreementEditor({
  draft,
  onChange,
  showProblems,
  dateError,
  tenant,
}: {
  draft: AgreementDraft;
  onChange: (draft: AgreementDraft) => void;
  showProblems: boolean;
  dateError: string | undefined;
  tenant: Tenant;
}) {
  const { t, i18n } = useTranslation(['compensation', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const presetsId = useId();
  const services = useQuery(servicesQuery());
  const problems = showProblems ? draftProblems(draft, locale) : {};
  const problem = (field: DraftField) => {
    const found = problems[field];
    return found === undefined ? undefined : t(`compensation:form.problems.${found}`);
  };
  const set = (patch: Partial<AgreementDraft>) => {
    onChange({ ...draft, ...patch });
  };
  const toggle = (kind: ComponentKind, on: boolean) => {
    set({ on: { ...draft.on, [kind]: on } });
  };
  const custom = draft.preset === 'custom';
  const visible = (kind: ComponentKind) => custom || draft.on[kind];
  const money = (
    value: string,
    onValue: (text: string) => void,
    field?: DraftField,
    label = t('compensation:form.amount'),
  ) => (
    <Field label={label} error={field ? problem(field) : undefined}>
      {(props) => (
        <MoneyInput
          {...props}
          value={value}
          onChange={onValue}
          currency={tenant.currency}
          locale={locale}
        />
      )}
    </Field>
  );
  const activeServices = (services.data ?? []).filter((service) => service.active);
  const categories = [
    ...new Set(activeServices.flatMap((service) => (service.category ? [service.category] : []))),
  ].sort((a, b) => a.localeCompare(b, locale));

  const setOverride = (index: number, patch: Partial<RateOverride>) => {
    set({
      share: {
        ...draft.share,
        overrides: draft.share.overrides.map((override, at) =>
          at === index ? { ...override, ...patch } : override,
        ),
      },
    });
  };

  const sections: Record<ComponentKind, ReactNode> = {
    monthlyFixed: (
      <>
        <Segmented
          label={t('compensation:form.fixed.direction')}
          value={draft.fixed.direction}
          options={[
            { value: 'pay', label: t('compensation:form.fixed.pay') },
            { value: 'charge', label: t('compensation:form.fixed.charge') },
          ]}
          onChange={(direction) => {
            set({ fixed: { ...draft.fixed, direction } });
          }}
        />
        {money(
          draft.fixed.amount,
          (amount) => {
            set({ fixed: { ...draft.fixed, amount } });
          },
          'fixed.amount',
          t('compensation:form.fixed.amount'),
        )}
        <SwitchRow
          label={t('compensation:form.fixed.prorate')}
          hint={t('compensation:form.fixed.prorateHint')}
          checked={draft.fixed.prorate}
          onChange={(prorate) => {
            set({ fixed: { ...draft.fixed, prorate } });
          }}
        />
      </>
    ),
    share: (
      <>
        <div className="grid grid-cols-[110px_1fr] items-end gap-3">
          <Field label={t('compensation:form.share.percent')} error={problem('share.percent')}>
            {(props) => (
              <div className="relative">
                <TextInput
                  {...props}
                  inputMode="decimal"
                  dir="ltr"
                  value={draft.share.percent}
                  onChange={(event) => {
                    set({ share: { ...draft.share, percent: event.target.value } });
                  }}
                  className="pe-7 text-end font-mono"
                />
                <span className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-[12.5px] text-ink-muted">
                  %
                </span>
              </div>
            )}
          </Field>
          <Segmented
            label={t('compensation:form.share.basis')}
            value={draft.share.basis}
            options={[
              { value: 'collection', label: t('compensation:form.share.collection') },
              { value: 'production', label: t('compensation:form.share.production') },
            ]}
            onChange={(basis) => {
              set({ share: { ...draft.share, basis } });
            }}
          />
        </div>
        <div>
          <Eyebrow>{t('compensation:form.share.overrides')}</Eyebrow>
          <p className="m-0 mt-1 mb-2 text-[12px] leading-snug text-ink-muted">
            {t('compensation:form.share.overridesHint')}
          </p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {draft.share.overrides.map((override, index) => (
              <li key={index} className="grid grid-cols-[96px_1fr_72px_30px] items-center gap-2">
                <Select
                  aria-label={t('compensation:form.share.target')}
                  value={override.target}
                  onChange={(event) => {
                    setOverride(index, {
                      target: event.target.value === 'category' ? 'category' : 'service',
                      key: '',
                    });
                  }}
                >
                  <option value="service">{t('compensation:form.share.service')}</option>
                  <option value="category">{t('compensation:form.share.category')}</option>
                </Select>
                <Select
                  aria-label={t(
                    override.target === 'service'
                      ? 'compensation:form.share.service'
                      : 'compensation:form.share.category',
                  )}
                  value={override.key}
                  onChange={(event) => {
                    setOverride(index, { key: event.target.value });
                  }}
                >
                  <option value="" disabled>
                    {t('compensation:form.share.choose')}
                  </option>
                  {override.target === 'service'
                    ? activeServices.map((service) => (
                        <option key={service.id} value={service.code}>
                          {`${service.code} · ${service.name}`}
                        </option>
                      ))
                    : categories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                </Select>
                <TextInput
                  aria-label={t('compensation:form.share.percent')}
                  inputMode="decimal"
                  dir="ltr"
                  value={override.percent}
                  onChange={(event) => {
                    setOverride(index, { percent: event.target.value });
                  }}
                  className="text-end font-mono"
                />
                <IconButton
                  aria-label={t('compensation:form.share.remove')}
                  onClick={() => {
                    set({
                      share: {
                        ...draft.share,
                        overrides: draft.share.overrides.filter((_, at) => at !== index),
                      },
                    });
                  }}
                >
                  <span aria-hidden>×</span>
                </IconButton>
              </li>
            ))}
          </ul>
          {problem('share.overrides') && (
            <p role="alert" className="m-0 mt-1.5 text-xs font-medium text-danger">
              {problem('share.overrides')}
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 px-0"
            onClick={() => {
              set({
                share: {
                  ...draft.share,
                  overrides: [
                    ...draft.share.overrides,
                    { target: 'service', key: '', percent: draft.share.percent },
                  ],
                },
              });
            }}
          >
            {t('compensation:form.share.addOverride')}
          </Button>
        </div>
        {money(
          draft.share.threshold,
          (threshold) => {
            set({ share: { ...draft.share, threshold } });
          },
          'share.threshold',
          t('compensation:form.share.threshold'),
        )}
      </>
    ),
    perVisit: (
      <>
        {money(
          draft.perVisit.amount,
          (amount) => {
            set({ perVisit: { ...draft.perVisit, amount } });
          },
          'perVisit.amount',
          t('compensation:form.perVisit.amount'),
        )}
        <div>
          <Eyebrow>{t('compensation:form.perVisit.byType')}</Eyebrow>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {VISIT_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 text-[12.5px]">
                <span className="w-24 flex-none text-ink-secondary">
                  {t(`compensation:visitTypes.${type}`)}
                </span>
                <MoneyInput
                  value={draft.perVisit.byType[type] ?? ''}
                  onChange={(text) => {
                    set({
                      perVisit: {
                        ...draft.perVisit,
                        byType: { ...draft.perVisit.byType, [type]: text },
                      },
                    });
                  }}
                  currency={tenant.currency}
                  locale={locale}
                  placeholder={t('compensation:form.perVisit.same')}
                />
              </label>
            ))}
          </div>
        </div>
        <SwitchRow
          label={t('compensation:form.perVisit.chargedOnly')}
          hint={t('compensation:form.perVisit.chargedOnlyHint')}
          checked={draft.perVisit.chargedOnly}
          onChange={(chargedOnly) => {
            set({ perVisit: { ...draft.perVisit, chargedOnly } });
          }}
        />
      </>
    ),
    perDay: money(
      draft.perDay.amount,
      (amount) => {
        set({ perDay: { amount } });
      },
      'perDay.amount',
      t('compensation:form.perDay.amount'),
    ),
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div id={presetsId} className="mb-1.5 text-[12.5px] leading-none font-medium">
          {t('compensation:form.preset')}
        </div>
        <div role="group" aria-labelledby={presetsId} className="grid grid-cols-2 gap-2">
          {AGREEMENT_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={draft.preset === preset}
              onClick={() => {
                if (preset === draft.preset) return;
                onChange({
                  ...presetDraft(preset, draft.effectiveFrom),
                  visible: draft.visible,
                  note: draft.note,
                });
              }}
              className={cn(
                'flex cursor-pointer flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-start',
                draft.preset === preset
                  ? 'border-primary bg-primary-tint'
                  : 'border-border bg-surface hover:border-ink',
              )}
            >
              <span className="text-[12.5px] font-semibold">
                {t(`compensation:presets.${preset}.label`)}
              </span>
              <span className="text-[11.5px] leading-snug text-ink-muted">
                {t(`compensation:presets.${preset}.hint`)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <Field label={t('compensation:form.effectiveFrom')} error={dateError}>
        {(props) => (
          <DateInput
            {...props}
            value={draft.effectiveFrom}
            onChange={(effectiveFrom) => {
              set({ effectiveFrom });
            }}
            order={dateInputOrder(tenant.country)}
            today={todayIn(tenant.timeZone)}
            max={FAR_FUTURE}
            pickerLabel={t('compensation:form.chooseDate')}
          />
        )}
      </Field>

      {problem('components') && (
        <p role="alert" className="m-0 text-xs font-medium text-danger">
          {problem('components')}
        </p>
      )}
      {COMPONENT_KINDS.filter(visible).map((kind) => (
        <Section
          key={kind}
          title={t(`compensation:components.${kind}`)}
          addable={custom}
          on={draft.on[kind]}
          onToggle={(on) => {
            toggle(kind, on);
          }}
        >
          {sections[kind]}
        </Section>
      ))}

      <SwitchRow
        label={t('compensation:form.visible')}
        hint={t('compensation:form.visibleHint')}
        checked={draft.visible}
        onChange={(visible) => {
          set({ visible });
        }}
      />
      <Field label={t('compensation:form.note')} hint={t('compensation:form.optional')}>
        {(props) => (
          <TextInput
            {...props}
            value={draft.note}
            maxLength={NOTE_MAX}
            onChange={(event) => {
              set({ note: event.target.value });
            }}
          />
        )}
      </Field>
    </div>
  );
}
