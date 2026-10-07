import { CHARGE_UNITS, TOOTH_EFFECTS } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { type CatalogTab, type DraftRow, type RowPatch, sanitizePrice } from './catalog-draft';
import { CATALOG_GRID } from './catalog-layout';
import { FrequentToggle } from './frequent-toggle';

/** 32px table inputs: bordered when editable, borderless when read-only. */
const cell = (readOnly: boolean) =>
  cn(
    'h-8 w-full min-w-0 rounded-md border px-2',
    readOnly ? 'border-transparent bg-transparent' : 'border-border bg-surface',
  );

export function CatalogRow({
  tab,
  row,
  readOnly,
  changed,
  error,
  currency,
  categoryListId,
  onChange,
  onDelete,
}: {
  tab: CatalogTab;
  row: DraftRow;
  readOnly: boolean;
  changed: boolean;
  /** Row-level message (duplicate code), shown under the row. */
  error: string | undefined;
  /** Currency symbol of the row's price. */
  currency: string;
  categoryListId: string;
  onChange: (patch: RowPatch) => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation('catalog');
  const nameMissing = !readOnly && row.name.trim() === '';
  const codeInvalid = !readOnly && (row.code.trim() === '' || error !== undefined);
  const errorId = `catalog-row-error-${row.key}`;
  const name = row.name.trim() || t('delete.unnamed');

  return (
    <div
      role="row"
      className={cn(
        'grid min-h-[50px] items-center gap-2.5 border-t border-row-divider px-3.5 py-1.5',
        changed ? 'bg-dirty' : 'bg-surface',
        !row.active && 'opacity-60',
      )}
      style={{ gridTemplateColumns: CATALOG_GRID[tab] }}
    >
      <input
        aria-label={t('columns.code')}
        aria-invalid={codeInvalid}
        aria-describedby={error ? errorId : undefined}
        readOnly={readOnly}
        value={row.code}
        onChange={(event) => {
          onChange({ code: event.target.value.toUpperCase() });
        }}
        className={cn(
          cell(readOnly),
          'font-mono text-[12.5px] leading-none font-medium',
          codeInvalid && 'border-danger',
        )}
      />
      <input
        aria-label={t('columns.name')}
        aria-invalid={nameMissing}
        readOnly={readOnly}
        value={row.name}
        onChange={(event) => {
          onChange({ name: event.target.value });
        }}
        className={cn(
          cell(readOnly),
          'text-[13px] leading-none font-medium',
          nameMissing && 'border-danger',
          !row.active && 'line-through',
        )}
      />
      <FrequentToggle
        on={row.frequent}
        readOnly={readOnly}
        onToggle={() => {
          onChange({ frequent: !row.frequent });
        }}
      />
      {tab === 'services' &&
        (row.chargeUnit === 'per_tooth' ? (
          <select
            aria-label={t('columns.toothEffect')}
            title={t('toothEffectHint')}
            disabled={readOnly}
            value={row.toothEffect}
            onChange={(event) => {
              const effect = TOOTH_EFFECTS.find((candidate) => candidate === event.target.value);
              if (effect) onChange({ toothEffect: effect });
            }}
            className={cn(
              cell(readOnly),
              'text-[12.5px] leading-none disabled:opacity-100',
              readOnly && 'appearance-none',
              row.toothEffect === 'none' && 'text-ink-muted',
            )}
          >
            {TOOTH_EFFECTS.map((effect) => (
              <option key={effect} value={effect}>
                {t(`toothEffect.${effect}`)}
              </option>
            ))}
          </select>
        ) : (
          // A service on a jaw or the whole mouth changes no tooth: nothing to choose.
          <span role="presentation" />
        ))}
      <input
        aria-label={t('columns.category')}
        readOnly={readOnly}
        list={readOnly ? undefined : categoryListId}
        value={row.category}
        onChange={(event) => {
          onChange({ category: event.target.value });
        }}
        className={cn(cell(readOnly), 'text-[12.5px] leading-none')}
      />
      {tab === 'services' && (
        <>
          <select
            aria-label={t('columns.charged')}
            disabled={readOnly}
            value={row.chargeUnit}
            onChange={(event) => {
              const unit = CHARGE_UNITS.find((candidate) => candidate === event.target.value);
              if (unit) onChange({ chargeUnit: unit });
            }}
            className={cn(
              cell(readOnly),
              'text-[12.5px] leading-none disabled:opacity-100',
              readOnly && 'appearance-none',
            )}
          >
            {CHARGE_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {t(`chargeUnit.${unit}`)}
              </option>
            ))}
          </select>
          <label
            className={cn(
              'flex h-8 items-center gap-[3px] rounded-md border px-2 font-mono text-[12.5px] leading-none font-medium',
              readOnly ? 'border-transparent' : 'border-border bg-surface',
            )}
          >
            <span className="text-ink-muted">{currency}</span>
            <input
              aria-label={t('columns.price')}
              readOnly={readOnly}
              inputMode="decimal"
              value={row.price}
              onChange={(event) => {
                onChange({
                  price: sanitizePrice(event.target.value, i18n.resolvedLanguage ?? 'en'),
                });
              }}
              className="w-full min-w-0 border-none bg-transparent text-end tabular-nums outline-none"
            />
          </label>
        </>
      )}
      <Switch
        checked={row.active}
        disabled={readOnly}
        label={t('columns.active')}
        onCheckedChange={(active) => {
          onChange({ active });
        }}
      />
      <span className="flex items-center justify-end gap-1.5">
        {changed && (
          <span title={t('unsavedRow')} className="size-[7px] rounded-full bg-warning-dot" />
        )}
        {!readOnly && (
          <IconButton
            aria-label={t('delete.label', { name })}
            onClick={onDelete}
            className="text-danger hover:border-danger-border hover:bg-danger-bg hover:text-danger"
          >
            <svg
              aria-hidden
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" />
            </svg>
          </IconButton>
        )}
      </span>
      {error && (
        <p id={errorId} className="col-span-full -mt-0.5 text-[11.5px] leading-snug text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
