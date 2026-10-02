import {
  DISCOUNT_MODES,
  parseTooth,
  SURFACES,
  type SurfaceKey,
  validSurfaces,
  type VisitListItem,
} from '@dcm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useChartSettings, useSurfaceLabel, useToothLabel } from '../chart/use-chart-settings';
import type { AmendDraft, AmendLine } from './amend-draft';

const inputClass =
  'h-8 rounded-md border border-border-control bg-surface px-2 text-[12.5px] leading-none';

/**
 * One service while amending (D1, D2): per-tooth services take a tooth (typed in the clinic's
 * notation) and the surfaces that tooth has; one that performed a plan can only be removed; any
 * service can be removed and put back. `onInvalid` reports a tooth that doesn't parse, which
 * blocks saving.
 */
function AmendServiceRow({
  line,
  service,
  locale,
  onChange,
  onInvalid,
}: {
  line: AmendLine;
  service: VisitListItem['services'][number];
  locale: string;
  onChange: (next: AmendLine) => void;
  onInvalid: (invalid: boolean) => void;
}) {
  const { t } = useTranslation('visits');
  const { notation } = useChartSettings();
  const toothLabel = useToothLabel();
  const surfaceLabel = useSurfaceLabel();
  const [text, setText] = useState(() =>
    line.toothCode === null ? '' : toothLabel(line.toothCode).replace(/^#/, ''),
  );
  const locked = service.planId !== null;
  const tooth = line.toothCode;

  return (
    <li
      className={cn(
        'flex flex-col gap-2 border-t border-inner-divider py-2.5 first:border-t-0',
        line.removed && 'opacity-55',
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn('min-w-0 flex-1 text-[13px] leading-snug', line.removed && 'line-through')}
        >
          {service.name}
        </span>
        <span className="font-mono text-[12.5px]">{formatMoney(service.final, locale)}</span>
        <Button
          variant="ghost"
          size="sm"
          className="px-1.5"
          aria-label={
            line.removed
              ? t('amend.restore', { name: service.name })
              : t('amend.remove', { name: service.name })
          }
          onClick={() => {
            onChange({ ...line, removed: !line.removed });
          }}
        >
          {line.removed ? t('amend.undo') : '×'}
        </Button>
      </div>
      {line.removed && locked && (
        <p className="text-[11.5px] leading-snug text-ink-muted">{t('amend.planHint')}</p>
      )}
      {!line.removed && tooth !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-ink-muted">
            {t('amend.tooth')}
            <input
              value={text}
              disabled={locked}
              dir="ltr"
              aria-label={t('amend.toothOf', { name: service.name })}
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
          <div role="group" aria-label={t('amend.surfaces')} className="flex gap-1">
            {SURFACES.filter((surface) => validSurfaces(tooth, [surface])).map(
              (surface: SurfaceKey) => {
                const on = line.surfaces.includes(surface);
                return (
                  <button
                    key={surface}
                    type="button"
                    disabled={locked}
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
          {locked && <span className="text-[11.5px] text-ink-muted">{t('amend.planLocked')}</span>}
        </div>
      )}
    </li>
  );
}

/** The panel body while amending: the services and the visit discount. */
export function AmendForm({
  visit,
  draft,
  locale,
  onChange,
  onInvalidTeeth,
}: {
  visit: VisitListItem;
  draft: AmendDraft;
  locale: string;
  onChange: (next: AmendDraft) => void;
  onInvalidTeeth: (ids: ReadonlySet<string>) => void;
}) {
  const { t } = useTranslation('visits');
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());

  return (
    <>
      <section className="flex flex-col">
        <h3 className="mb-1 text-[13px] leading-none font-semibold">{t('panel.services')}</h3>
        <ul className="m-0 list-none p-0">
          {draft.lines.map((line, index) => {
            const service = visit.services.find((candidate) => candidate.id === line.id);
            if (!service) return null;
            return (
              <AmendServiceRow
                key={line.id}
                line={line}
                service={service}
                locale={locale}
                onChange={(next) => {
                  const lines = [...draft.lines];
                  lines[index] = next;
                  onChange({ ...draft, lines });
                }}
                onInvalid={(bad) => {
                  const next = new Set(invalid);
                  if (bad) next.add(line.id);
                  else next.delete(line.id);
                  setInvalid(next);
                  onInvalidTeeth(next);
                }}
              />
            );
          })}
        </ul>
      </section>
      <label className="flex items-center gap-2 text-[12.5px]">
        <span className="font-medium">{t('amend.discount')}</span>
        <select
          aria-label={t('amend.discountMode')}
          value={draft.discount.mode}
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
