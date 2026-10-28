import {
  DISCOUNT_MODES,
  JAWS,
  parseTooth,
  SURFACES,
  type SurfaceKey,
  validSurfaces,
  type VisitListItem,
} from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { servicesQuery } from '../catalog/catalog-api';
import {
  useChartSettings,
  useLevelLabel,
  useSurfaceLabel,
  useToothLabel,
} from '../chart/use-chart-settings';
import { ServicePicker } from '../flow/service-picker';
import { type AmendDraft, type AmendLine, withService } from './amend-draft';
import { TimesForm } from './times-form';

const inputClass =
  'h-8 rounded-md border border-border-control bg-surface px-2 text-[12.5px] leading-none';

/**
 * One service while correcting (D1, D2, ADR-0062). A per-tooth service takes a tooth (typed in
 * the clinic's notation) and the surfaces that tooth has; an added per-jaw one its jaw. One that
 * performed a plan can't move. The price is editable with `visit:discount`. A kept service can be
 * removed and put back; an added one is dropped. `onInvalid` reports a tooth that doesn't parse,
 * which blocks saving.
 */
function CorrectionRow({
  line,
  name,
  currency,
  planLinked,
  canPrice,
  locale,
  onChange,
  onRemove,
  onInvalid,
}: {
  line: AmendLine;
  name: string;
  currency: string;
  planLinked: boolean;
  canPrice: boolean;
  locale: string;
  onChange: (next: AmendLine) => void;
  onRemove: () => void;
  onInvalid: (invalid: boolean) => void;
}) {
  const { t } = useTranslation('visits');
  const { notation } = useChartSettings();
  const toothLabel = useToothLabel();
  const surfaceLabel = useSurfaceLabel();
  const levelLabel = useLevelLabel();
  const [text, setText] = useState(() =>
    line.toothCode === null ? '' : toothLabel(line.toothCode).replace(/^#/, ''),
  );
  const removed = line.kind === 'kept' && line.removed;
  const perTooth =
    line.kind === 'added' ? line.chargeUnit === 'per_tooth' : line.toothCode !== null;
  const tooth = line.toothCode;

  return (
    <li
      className={cn(
        'flex flex-col gap-2 border-t border-inner-divider py-2.5 first:border-t-0',
        removed && 'opacity-55',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('min-w-0 flex-1 text-[13px] leading-snug', removed && 'line-through')}>
          {name}
          {line.kind === 'added' && (
            <span className="ms-1.5 text-[11.5px] text-primary">{t('amend.added')}</span>
          )}
        </span>
        {canPrice && !removed ? (
          <input
            value={line.price}
            inputMode="decimal"
            dir="ltr"
            aria-label={t('amend.priceOf', { name })}
            onChange={(event) => {
              onChange({ ...line, price: event.target.value });
            }}
            className={cn(inputClass, 'w-20 text-end font-mono')}
          />
        ) : (
          <span className="font-mono text-[12.5px]">
            {formatMoney({ amount: line.price || '0', currency }, locale)}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="px-1.5"
          aria-label={removed ? t('amend.restore', { name }) : t('amend.remove', { name })}
          onClick={() => {
            if (line.kind === 'kept') onChange({ ...line, removed: !line.removed });
            else onRemove();
          }}
        >
          {removed ? t('amend.undo') : '×'}
        </Button>
      </div>
      {removed && planLinked && (
        <p className="text-[11.5px] leading-snug text-ink-muted">{t('amend.planHint')}</p>
      )}
      {!removed && perTooth && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-ink-muted">
            {t('amend.tooth')}
            <input
              value={text}
              disabled={planLinked}
              dir="ltr"
              aria-label={t('amend.toothOf', { name })}
              onChange={(event) => {
                setText(event.target.value);
                const code = parseTooth(event.target.value, notation);
                onInvalid(code === null);
                if (code !== null) {
                  onChange({
                    ...line,
                    toothCode: code,
                    surfaces: line.surfaces.filter((surface) => validSurfaces(code, [surface])),
                  });
                }
              }}
              className={cn(inputClass, 'w-14 font-mono')}
            />
          </label>
          {tooth !== null && (
            <div role="group" aria-label={t('amend.surfaces')} className="flex gap-1">
              {SURFACES.filter((surface) => validSurfaces(tooth, [surface])).map(
                (surface: SurfaceKey) => {
                  const on = line.surfaces.includes(surface);
                  return (
                    <button
                      key={surface}
                      type="button"
                      disabled={planLinked}
                      aria-pressed={on}
                      title={surfaceLabel.name(surface)}
                      onClick={() => {
                        onChange({
                          ...line,
                          surfaces: on
                            ? line.surfaces.filter((candidate) => candidate !== surface)
                            : [...line.surfaces, surface],
                        });
                      }}
                      className={cn(
                        'size-7 rounded-md border font-mono text-[11.5px] disabled:opacity-50',
                        on
                          ? 'border-primary bg-primary-tint text-primary'
                          : 'border-border-control bg-surface text-ink-secondary',
                      )}
                    >
                      {surfaceLabel.short(surface)}
                    </button>
                  );
                },
              )}
            </div>
          )}
          {planLinked && (
            <span className="text-[11.5px] text-ink-muted">{t('amend.planLocked')}</span>
          )}
        </div>
      )}
      {line.kind === 'added' && line.chargeUnit === 'per_jaw' && (
        <label className="flex items-center gap-1.5 text-[12px] text-ink-muted">
          {t('amend.jaw')}
          <select
            value={line.jaw ?? ''}
            aria-label={t('amend.jawOf', { name })}
            onChange={(event) => {
              const jaw = JAWS.find((candidate) => candidate === event.target.value) ?? null;
              onChange({ ...line, jaw });
            }}
            className={inputClass}
          >
            <option value="">{t('amend.chooseJaw')}</option>
            {JAWS.map((jaw) => (
              <option key={jaw} value={jaw}>
                {levelLabel(jaw)}
              </option>
            ))}
          </select>
        </label>
      )}
    </li>
  );
}

/**
 * The panel body while correcting a finished visit (ADR-0062): its start and end, the services —
 * moved, repriced with `visit:discount`, removed, or added from the catalog — and the visit
 * discount. An imported visit's correction is its times only.
 */
export function AmendForm({
  visit,
  draft,
  timeZone,
  locale,
  canPrice,
  onChange,
  onInvalidTeeth,
}: {
  visit: VisitListItem;
  draft: AmendDraft;
  timeZone: string;
  locale: string;
  canPrice: boolean;
  onChange: (next: AmendDraft) => void;
  onInvalidTeeth: (keys: ReadonlySet<string>) => void;
}) {
  const { t } = useTranslation('visits');
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const catalog = useQuery({ ...servicesQuery(), enabled: adding });
  const times = (
    <TimesForm
      visit={visit}
      draft={draft.times}
      timeZone={timeZone}
      locale={locale}
      onChange={(next) => {
        onChange({ ...draft, times: next });
      }}
    />
  );
  if (visit.imported) {
    return (
      <>
        {times}
        <p className="text-[12.5px] leading-snug text-ink-secondary">{t('amend.importedNote')}</p>
      </>
    );
  }

  const report = (key: string, bad: boolean) => {
    const next = new Set(invalid);
    if (bad) next.add(key);
    else next.delete(key);
    setInvalid(next);
    onInvalidTeeth(next);
  };

  return (
    <>
      {times}
      <section className="flex flex-col border-t border-inner-divider pt-3">
        <h3 className="mb-1 text-[13px] leading-none font-semibold">{t('panel.services')}</h3>
        <ul className="m-0 list-none p-0">
          {draft.lines.map((line, index) => {
            const service =
              line.kind === 'kept'
                ? visit.services.find((candidate) => candidate.id === line.key)
                : undefined;
            if (line.kind === 'kept' && !service) return null;
            return (
              <CorrectionRow
                key={line.key}
                line={line}
                name={service?.name ?? (line.kind === 'added' ? line.name : '')}
                currency={visit.currency}
                planLinked={service?.planId != null}
                canPrice={canPrice}
                locale={locale}
                onChange={(next) => {
                  const lines = [...draft.lines];
                  lines[index] = next;
                  onChange({ ...draft, lines });
                }}
                onRemove={() => {
                  report(line.key, false);
                  onChange({ ...draft, lines: draft.lines.filter((other) => other !== line) });
                }}
                onInvalid={(bad) => {
                  report(line.key, bad);
                }}
              />
            );
          })}
        </ul>
        <div className="mt-2 flex flex-col gap-2">
          {adding ? (
            <ServicePicker
              services={(catalog.data ?? []).filter((item) => item.active)}
              searchLabel={t('amend.addSearch')}
              onPick={(item) => {
                onChange(withService(draft, item));
                setAdding(false);
              }}
            />
          ) : (
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAdding(true);
                }}
              >
                {t('amend.addService')}
              </Button>
            </div>
          )}
        </div>
      </section>
      <label className="flex items-center gap-2 text-[12.5px]">
        <span className="font-medium">{t('amend.discount')}</span>
        <select
          aria-label={t('amend.discountMode')}
          value={draft.discount.mode}
          disabled={!canPrice}
          onChange={(event) => {
            const mode = DISCOUNT_MODES.find((candidate) => candidate === event.target.value);
            if (mode) onChange({ ...draft, discount: { ...draft.discount, mode } });
          }}
          className={inputClass}
        >
          {DISCOUNT_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {t(`amend.mode.${mode}`)}
            </option>
          ))}
        </select>
        <input
          value={draft.discount.value}
          inputMode="decimal"
          dir="ltr"
          disabled={!canPrice}
          aria-label={t('amend.discountValue')}
          onChange={(event) => {
            onChange({ ...draft, discount: { ...draft.discount, value: event.target.value } });
          }}
          className={cn(inputClass, 'w-24 font-mono')}
        />
      </label>
    </>
  );
}
