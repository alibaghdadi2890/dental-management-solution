import type { DiagnosisItem, ServiceItem } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CardSkeleton } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/list';
import { RightPanel } from '@/components/ui/right-panel';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { diagnosesQuery, servicesQuery } from '../catalog/catalog-api';
import {
  useChartSettings,
  useSurfaceLabel,
  useToothLabel,
  useToothName,
} from '../chart/use-chart-settings';
import { type ChartTarget, type DrawerMode, useChartingActions } from './charting-actions';
import {
  type DrawerGroup,
  type DrawerHeading,
  drawerCategories,
  drawerGroups,
} from './drawer-list';
import { useToothSelection } from './tooth-selection';

type Row = ServiceItem | DiagnosisItem;

const isService = (row: Row): row is ServiceItem => 'chargeUnit' in row;

/**
 * The Add service / Plan treatment / Diagnosis drawer (spec §Add Service / Plan Treatment /
 * Diagnosis Drawer): one drawer, three modes with their own title, placeholder and footer. The
 * header names the target — the selected tooth and pending surfaces — over an autofocused search
 * and the category chips; the list shows the active catalog rows, grouped by `drawerGroups`. A
 * per-tooth row (and every diagnosis, W11) needs a tooth, so without one it is disabled. One
 * click commits and closes; the toast (with its Undo or Plan treatment) comes from
 * `ChartingActions`. It is modal (a `dialog` that keeps Tab inside it), so the chart's arrow keys
 * can't move the selection under a pending one-click commit.
 */
export function CatalogDrawer({ mode, onClose }: { mode: DrawerMode; onClose: () => void }) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const searchId = useId();
  const selection = useToothSelection();
  const actions = useChartingActions();
  const { mode: chartMode } = useChartSettings();
  const toothLabel = useToothLabel();
  const toothName = useToothName();
  const surfaceLabel = useSurfaceLabel();
  const services = useQuery({ ...servicesQuery(), enabled: mode !== 'diagnosis' });
  const diagnoses = useQuery({ ...diagnosesQuery(), enabled: mode === 'diagnosis' });
  const catalog = mode === 'diagnosis' ? diagnoses : services;
  const rows: Row[] = (catalog.data ?? []).filter((row) => row.active);

  const { tooth } = selection;
  // Surfaces only scope a record in surface mode (spec §Chart modes).
  const surfaces = chartMode === 'surface' && tooth !== null ? selection.surfaces : [];
  const target: ChartTarget = { tooth, surfaces };
  const surfaceText = surfaceLabel.format(surfaces);
  const toothText =
    tooth === null ? null : [toothLabel(tooth), surfaceText].filter(Boolean).join(' · ');

  const commit = (row: Row) => {
    if (isService(row)) {
      if (mode === 'plan') actions.planTreatment(row, target);
      else actions.addService(row, target);
      // The pending scope was used (spec invariant 9).
      if (tooth !== null) selection.select(tooth);
    } else {
      actions.recordDiagnosis(row, target);
    }
    onClose();
  };

  const meta = (row: Row): string => {
    if (!isService(row)) return row.category ?? '';
    if (row.chargeUnit === 'per_jaw') return t('drawer.perJaw');
    return toothText === null ? t('drawer.perTooth') : t('drawer.appliesTo', { target: toothText });
  };
  const disabled = (row: Row) =>
    tooth === null && (!isService(row) || row.chargeUnit === 'per_tooth');

  const heading = (value: DrawerHeading) => {
    switch (value.kind) {
      case 'frequent':
        return t('drawer.frequent');
      case 'category':
        return value.category;
      case 'uncategorized':
        return t('drawer.uncategorized');
      case 'matches':
        return t('drawer.matches', { count: value.count });
    }
  };

  const groups: DrawerGroup<Row>[] = drawerGroups(rows, query, category);
  const chips: (string | null)[] = [null, ...drawerCategories(rows)];

  return (
    <RightPanel
      title={t(`drawer.${mode}.title`)}
      subtitle={
        <p className="m-0 mt-[3px] text-[12.5px] leading-[1.4] text-ink-muted">
          {tooth === null
            ? t(mode === 'diagnosis' ? 'drawer.noToothDiagnosis' : 'drawer.noTooth')
            : [t('actions.tooth', { label: toothLabel(tooth) }), toothName(tooth), surfaceText]
                .filter(Boolean)
                .join(' · ')}
        </p>
      }
      toolbar={
        <div className="mt-3">
          <label htmlFor={searchId} className="sr-only">
            {t(`drawer.${mode}.placeholder`)}
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            placeholder={t(`drawer.${mode}.placeholder`)}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            className="h-[38px] w-full rounded-lg border border-border-control bg-sunken px-3 text-[13px] leading-none outline-none focus:border-primary focus:bg-surface"
          />
          {chips.length > 1 && (
            <div className="mt-[11px] flex flex-wrap gap-1.5">
              {chips.map((chip) => {
                const active = chip === category;
                return (
                  <button
                    key={chip ?? ''}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setCategory(chip);
                    }}
                    className={cn(
                      'h-[27px] cursor-pointer rounded-[14px] border px-[11px] text-[11.5px] leading-none font-medium',
                      active
                        ? 'border-ink bg-ink text-white'
                        : 'border-border bg-faint text-ink-secondary hover:border-border-strong',
                    )}
                  >
                    {chip ?? t('drawer.all')}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      }
      dirty={false}
      onClose={onClose}
      initialFocus="field"
      modal
      className="absolute inset-y-0 end-0 z-30 w-[428px] max-w-full shadow-[-14px_0_40px_rgba(27,26,31,.14)] rtl:shadow-[14px_0_40px_rgba(27,26,31,.14)]"
      bodyClassName="gap-0 px-0 pt-1.5 pb-3"
      footer={
        <p className="m-0 flex-1 text-[12.5px] leading-normal text-ink-muted">
          {t(`drawer.${mode}.footer`)}
        </p>
      }
      footerClassName="justify-start bg-sunken"
    >
      {catalog.data === undefined ? (
        catalog.error ? (
          <ErrorState
            title={t('drawer.failedTitle')}
            body={t('drawer.failedBody')}
            requestId={catalog.error instanceof ApiError ? catalog.error.requestId : undefined}
            onRetry={() => void catalog.refetch()}
          />
        ) : (
          <div className="px-[18px] pt-3">
            <CardSkeleton label={t('drawer.loading')} />
          </div>
        )
      ) : groups.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <h3 className="m-0 mb-[5px] text-[14px] leading-[1.3] font-semibold">
            {query.trim()
              ? t('drawer.noResultsTitle', { query: query.trim() })
              : t('drawer.emptyTitle')}
          </h3>
          <p className="m-0 text-[12.5px] leading-normal text-ink-muted">
            {query.trim() ? t('drawer.noResultsBody') : t('drawer.emptyBody')}
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={JSON.stringify(group.heading)} aria-label={heading(group.heading)}>
            <h3 className="m-0 px-[18px] pt-3 pb-1.5 text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal">
              {heading(group.heading)}
            </h3>
            {group.items.map((row) => (
              <button
                key={row.id}
                type="button"
                disabled={disabled(row)}
                onClick={() => {
                  commit(row);
                }}
                className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-[18px] py-2.5 text-start hover:bg-faint disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] leading-[1.3] font-medium">{row.name}</span>
                  <span className="block text-[12.5px] leading-[1.3] text-ink-muted">
                    {meta(row)}
                  </span>
                </span>
                {isService(row) && (
                  <span
                    dir="ltr"
                    className="flex-none font-mono text-[13px] leading-none font-medium text-ink-secondary tabular-nums"
                  >
                    {formatMoney(row.price, locale)}
                  </span>
                )}
                <span
                  aria-hidden
                  className="grid size-[22px] flex-none place-items-center rounded-[5px] bg-primary-tint"
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 12 12"
                    className="stroke-primary"
                    strokeWidth="1.9"
                  >
                    <path d="M6 1.8v8.4M1.8 6h8.4" />
                  </svg>
                </span>
              </button>
            ))}
          </section>
        ))
      )}
    </RightPanel>
  );
}
