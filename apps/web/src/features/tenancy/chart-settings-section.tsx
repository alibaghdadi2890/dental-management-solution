import {
  CHART_ORIENTATIONS,
  type ChartMode,
  type ChartOrientation,
  type TenantSettingsPatch,
  TOOTH_NOTATIONS,
  type ToothNotation,
} from '@dcm/contracts';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/toast-context';
import {
  ChartDetailPreview,
  NotationPreview,
  OrientationPreview,
} from '@/features/clinical/chart/chart-preview';
import { useChartSettings, useSurfaceLabel } from '@/features/clinical/chart/use-chart-settings';
import { usePermission } from '@/features/auth/use-permission';
import { cn } from '@/lib/utils';
import { useUpdateTenantSettings } from './tenancy-api';

/** POC visual order (Simple first, Surface second) — not `CHART_MODES`' declaration order. */
const DETAIL_OPTIONS: readonly ChartMode[] = ['simple', 'surface'];

/** The one patch key each card group writes, also `useState`'s "which group is saving" value
 * (§5: only the group being changed disables, not all three). */
type SettingGroup = 'chartMode' | 'toothNotation' | 'chartOrientation';

function RadioCard<T extends string>({
  name,
  value,
  checked,
  disabled,
  label,
  body,
  preview,
  inUseLabel,
  notInUseLabel,
  onSelect,
}: {
  name: string;
  value: T;
  checked: boolean;
  disabled: boolean;
  label: string;
  body: ReactNode;
  preview: ReactNode;
  inUseLabel: string;
  notInUseLabel: string;
  onSelect: (value: T) => void;
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-3.5 rounded-[10px] border p-4 text-start has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary',
        checked
          ? 'border-primary bg-selected shadow-[0_0_0_3px_rgba(59,63,143,.12)]'
          : 'border-border bg-surface',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => {
          onSelect(value);
        }}
        className="sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'mt-px size-4 flex-none rounded-full border',
          checked
            ? 'border-primary bg-primary shadow-[inset_0_0_0_3px_var(--color-surface)]'
            : 'border-border-strong bg-surface',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="mb-[5px] flex items-center gap-[9px]">
          <span className="text-[14px] leading-tight font-semibold">{label}</span>
          <span
            className={cn(
              'rounded-[5px] border px-2 py-[3px] text-[12.5px] leading-none font-medium',
              checked
                ? 'border-primary-tint-border bg-primary-tint text-primary'
                : 'border-border bg-subtle text-ink-muted',
            )}
          >
            {checked ? inUseLabel : notInUseLabel}
          </span>
        </span>
        <span className="block text-[12.5px] leading-[1.6] text-ink-secondary">{body}</span>
      </span>
      <span className="flex flex-none items-center ps-1.5">{preview}</span>
    </label>
  );
}

/**
 * Settings → Dental / tooth chart (spec §Settings; ADR-0021, W3, W17, W25): three tenant-level
 * chart preferences, each a radio-card group with an In use / Not in use badge and a live
 * preview, plus the static Dentition explanation. Every card stays mounted and disabled without
 * `tenant:write` (W18-style read-only, catalog's own pattern), with one note above the groups.
 * While a group's own PATCH is in flight only that group's cards disable — the other two groups
 * stay live — and a failure re-enables the group with the previous option still selected, since
 * the session (the source of truth for `mode`/`notation`/`orientation`) is only refetched on
 * success.
 */
export function ChartSettingsSection() {
  const { t } = useTranslation(['settings', 'clinical']);
  const toast = useToast();
  const canWrite = usePermission('tenant:write');
  const { mode, notation, orientation } = useChartSettings();
  const surfaceLabel = useSurfaceLabel();
  const mutation = useUpdateTenantSettings();
  // Which group's own PATCH is in flight — only that group's cards disable while it saves; a
  // failure clears this without touching the session, so the old option stays selected (§4/§5).
  const [pendingGroup, setPendingGroup] = useState<SettingGroup | null>(null);

  const inUseLabel = t('chart.inUse');
  const notInUseLabel = t('chart.notInUse');
  const detailDisabled = !canWrite || pendingGroup === 'chartMode';
  const notationDisabled = !canWrite || pendingGroup === 'toothNotation';
  const orientationDisabled = !canWrite || pendingGroup === 'chartOrientation';

  const apply = (group: SettingGroup, patch: TenantSettingsPatch, toastText: string) => {
    setPendingGroup(group);
    mutation.mutate(patch, {
      onSuccess: () => {
        toast(toastText);
      },
      onError: () => {
        toast(t('chart.saveFailed'), { tone: 'danger' });
      },
      onSettled: () => {
        setPendingGroup(null);
      },
    });
  };

  const selectMode = (next: ChartMode) => {
    if (detailDisabled || next === mode) return;
    apply('chartMode', { chartMode: next }, t(`chart.detail.toast.${next}`));
  };
  const selectNotation = (next: ToothNotation) => {
    if (notationDisabled || next === notation) return;
    apply('toothNotation', { toothNotation: next }, t(`chart.notation.toast.${next}`));
  };
  const selectOrientation = (next: ChartOrientation) => {
    if (orientationDisabled || next === orientation) return;
    apply('chartOrientation', { chartOrientation: next }, t(`chart.orientation.toast.${next}`));
  };

  const surfaceBody = t('chart.detail.surface.body', {
    m: surfaceLabel.short('M'),
    d: surfaceLabel.short('D'),
    b: surfaceLabel.short('B'),
    l: surfaceLabel.short('L'),
    o: surfaceLabel.short('O'),
    i: surfaceLabel.short('I'),
  });

  return (
    <div className="max-w-[880px]">
      {!canWrite && (
        <div className="mb-4 rounded-lg border border-border bg-background px-3 py-2.5 text-[12.5px] leading-[1.45] text-ink-secondary">
          {t('chart.readOnly')}
        </div>
      )}

      <section className="mb-[26px]">
        <h2 className="mb-[5px] text-[15px] leading-tight font-semibold">
          {t('chart.detail.title')}
        </h2>
        <p className="mb-3.5 max-w-[64ch] text-[12.5px] leading-[1.6] text-ink-secondary">
          {t('chart.detail.intro')}
        </p>
        <div
          role="radiogroup"
          aria-label={t('chart.detail.group')}
          className="flex flex-col gap-2.5"
        >
          {DETAIL_OPTIONS.map((value) => (
            <RadioCard
              key={value}
              name="chartMode"
              value={value}
              checked={value === mode}
              disabled={detailDisabled}
              label={t(`chart.detail.${value}.label`)}
              body={value === 'surface' ? surfaceBody : t('chart.detail.simple.body')}
              preview={<ChartDetailPreview mode={value} orientation={orientation} />}
              inUseLabel={inUseLabel}
              notInUseLabel={notInUseLabel}
              onSelect={selectMode}
            />
          ))}
        </div>
      </section>

      <section className="mb-[26px]">
        <h2 className="mb-[5px] text-[15px] leading-tight font-semibold">
          {t('chart.notation.title')}
        </h2>
        <p className="mb-3.5 max-w-[64ch] text-[12.5px] leading-[1.6] text-ink-secondary">
          {t('chart.notation.intro')}
        </p>
        <div
          role="radiogroup"
          aria-label={t('chart.notation.group')}
          className="flex flex-col gap-2.5"
        >
          {TOOTH_NOTATIONS.map((value) => (
            <RadioCard
              key={value}
              name="toothNotation"
              value={value}
              checked={value === notation}
              disabled={notationDisabled}
              label={t(`chart.notation.${value}.label`)}
              body={t(`chart.notation.${value}.body`)}
              preview={<NotationPreview notation={value} />}
              inUseLabel={inUseLabel}
              notInUseLabel={notInUseLabel}
              onSelect={selectNotation}
            />
          ))}
        </div>
      </section>

      <section className="mb-[26px]">
        <h2 className="mb-[5px] text-[15px] leading-tight font-semibold">
          {t('chart.orientation.title')}
        </h2>
        <p className="mb-3.5 max-w-[64ch] text-[12.5px] leading-[1.6] text-ink-secondary">
          {t('chart.orientation.intro')}
        </p>
        <div
          role="radiogroup"
          aria-label={t('chart.orientation.group')}
          className="flex flex-col gap-2.5"
        >
          {CHART_ORIENTATIONS.map((value) => (
            <RadioCard
              key={value}
              name="chartOrientation"
              value={value}
              checked={value === orientation}
              disabled={orientationDisabled}
              label={t(`chart.orientation.${value}.label`)}
              body={t(`chart.orientation.${value}.body`)}
              preview={<OrientationPreview orientation={value} />}
              inUseLabel={inUseLabel}
              notInUseLabel={notInUseLabel}
              onSelect={selectOrientation}
            />
          ))}
        </div>
      </section>

      <section className="mb-[26px]">
        <h2 className="mb-[5px] text-[15px] leading-tight font-semibold">
          {t('chart.dentition.title')}
        </h2>
        <p className="mb-3.5 max-w-[64ch] text-[12.5px] leading-[1.6] text-ink-secondary">
          {t('chart.dentition.intro')}
        </p>
        <div className="rounded-[10px] border border-border bg-surface px-4 py-1">
          {(['primary', 'mixed', 'permanent'] as const).map((stage) => (
            <div
              key={stage}
              className="flex flex-wrap gap-x-3 gap-y-1 border-b border-row-divider py-[11px] last:border-b-0"
            >
              <span className="flex-none basis-[150px] text-[12.5px] leading-[1.4] font-semibold">
                {t(`chart.dentition.${stage}.stage`)}
              </span>
              <span className="flex-none basis-20 font-mono text-[12.5px] leading-[1.4] text-ink-muted">
                {t(`chart.dentition.${stage}.age`)}
              </span>
              <span className="min-w-0 flex-1 basis-60 text-[12.5px] leading-[1.55] text-ink-secondary">
                {t(`chart.dentition.${stage}.body`)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
