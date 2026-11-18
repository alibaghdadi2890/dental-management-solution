import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  type TooltipValueType,
  XAxis,
  YAxis,
} from 'recharts';
import { GRID } from './chart-tokens';

export interface ColumnSeries {
  key: string;
  label: string;
  color: string;
}

export interface ColumnRow {
  /** The short tick (Nov, 16 Nov). */
  label: string;
  /** The tooltip's heading (November 2026). */
  title: string;
  values: Record<string, number>;
}

/**
 * Columns over time (feature 19, D5): grouped, or stacked with `stacked`. Thin bars from zero with
 * slightly rounded ends, horizontal hairlines only, no border or axis titles, short ticks. One
 * tooltip lists every series of a column (exact values from `format`), plus `extra` lines. A click
 * on a column opens the rows behind it. Right to left, time runs from the right and the value axis
 * sits on the start side.
 */
export function ColumnChart({
  rows,
  series,
  stacked = false,
  height = 220,
  format,
  formatTick,
  extra,
  onSelect,
}: {
  rows: readonly ColumnRow[];
  series: readonly ColumnSeries[];
  stacked?: boolean;
  height?: number;
  format: (value: number) => string;
  formatTick: (value: number) => string;
  extra?: (index: number) => ReactNode;
  onSelect?: ((index: number) => void) | undefined;
}) {
  const { i18n } = useTranslation();
  const rtl = i18n.dir() === 'rtl';
  const data = rows.map((row, index) => ({ ...row.values, label: row.label, index }));
  const last = series.length - 1;
  const content = ({ active, payload }: TooltipContentProps<TooltipValueType, string | number>) => {
    const index = (payload[0]?.payload as { index?: number } | undefined)?.index;
    const row = index === undefined ? undefined : rows[index];
    if (!active || !row || index === undefined) return null;
    return (
      <div className="min-w-[150px] rounded-md bg-ink px-2.5 py-2 text-[12px] leading-snug text-white shadow-[0_6px_18px_rgba(27,26,31,.18)]">
        <div className="mb-1 font-semibold">{row.title}</div>
        {series.map((item) => (
          <div key={item.key} className="flex items-center gap-2">
            <span aria-hidden className="size-2 rounded-[2px]" style={{ background: item.color }} />
            <span className="flex-1">{item.label}</span>
            <span dir="ltr" className="font-mono tabular-nums">
              {format(row.values[item.key] ?? 0)}
            </span>
          </div>
        ))}
        {extra?.(index)}
      </div>
    );
  };
  return (
    <div dir="ltr" style={{ height }} className="w-full select-none">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
          barCategoryGap="28%"
          barGap={2}
          onClick={(state) => {
            const index = state.activeTooltipIndex;
            if (onSelect && index !== undefined && index !== null) onSelect(Number(index));
          }}
          style={{ cursor: onSelect ? 'pointer' : 'default' }}
        >
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="label"
            reversed={rtl}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            tick={{ fontSize: 11, fill: 'var(--color-ink-muted)' }}
          />
          <YAxis
            orientation={rtl ? 'right' : 'left'}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={formatTick}
            tick={{ fontSize: 11, fill: 'var(--color-ink-muted)' }}
          />
          <Tooltip
            content={content}
            cursor={{ fill: 'rgba(59, 63, 143, 0.06)' }}
            isAnimationActive={false}
          />
          {series.map((item, index) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              name={item.label}
              fill={item.color}
              maxBarSize={stacked ? 26 : 14}
              radius={!stacked || index === last ? [3, 3, 0, 0] : 0}
              {...(stacked ? { stackId: 'stack' } : {})}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
