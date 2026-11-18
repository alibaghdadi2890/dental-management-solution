import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { isDarkStep } from './chart-tokens';

/** Wraps a mark in the link to the rows behind it; without it the mark is not a link. */
export type MarkLink = (content: ReactNode, className: string) => ReactNode;

const MARK = 'block rounded-md outline-none focus-visible:outline-2 focus-visible:outline-ring';
const withLink = (link: MarkLink | undefined, content: ReactNode, className: string) =>
  link ? (
    link(content, cn(MARK, className, 'cursor-pointer hover:bg-faint'))
  ) : (
    <div className={className}>{content}</div>
  );

const widthOf = (value: number, max: number) =>
  `${String(max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0)}%`;

export interface BarItem {
  key: string;
  label: string;
  value: number;
  /** The value at the end of the bar. */
  display: string;
  /** Exact, on hover. */
  title?: string | undefined;
  color: string;
  link?: MarkLink | undefined;
}

/** Ranked horizontal bars (which is biggest), from zero, each with its value at the end. */
export function BarList({ items, max }: { items: readonly BarItem[]; max?: number }) {
  const top = max ?? Math.max(0, ...items.map((item) => item.value));
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item.key}>
          {withLink(
            item.link,
            <span className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2.5 px-1 py-1">
              <span className="truncate text-[12.5px] text-ink-secondary">{item.label}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-subtle">
                <span
                  className="block h-full rounded-full"
                  style={{ width: widthOf(item.value, top), background: item.color }}
                />
              </span>
              <span
                dir="ltr"
                title={item.title}
                className="min-w-14 text-end font-mono text-[12px] tabular-nums"
              >
                {item.display}
              </span>
            </span>,
            '',
          )}
        </li>
      ))}
    </ul>
  );
}

export interface PairedRow {
  key: string;
  label: string;
  bars: { label: string; value: number; display: string; title?: string; color: string }[];
  /** Further figures at the end of the row (compensation, its share). */
  trailing?: ReactNode;
  link?: MarkLink | undefined;
}

/** Several aligned bars per row on one scale (a dentist's production and collections). */
export function PairedBars({ rows }: { rows: readonly PairedRow[] }) {
  const max = Math.max(0, ...rows.flatMap((row) => row.bars.map((bar) => bar.value)));
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <li key={row.key}>
          {withLink(
            row.link,
            <span className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2.5 px-1 py-1">
              <span className="truncate text-[12.5px] text-ink-secondary">{row.label}</span>
              <span className="flex flex-col gap-1">
                {row.bars.map((bar) => (
                  <span key={bar.label} className="flex items-center gap-2">
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-subtle">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: widthOf(bar.value, max), background: bar.color }}
                      />
                    </span>
                    <span
                      dir="ltr"
                      title={bar.title}
                      className="w-16 text-end font-mono text-[11.5px] tabular-nums"
                    >
                      {bar.display}
                    </span>
                  </span>
                ))}
              </span>
              <span className="text-end">{row.trailing}</span>
            </span>,
            '',
          )}
        </li>
      ))}
    </ul>
  );
}

export interface Segment {
  key: string;
  label: string;
  value: number;
  display: string;
  color: string;
  link?: MarkLink | undefined;
}

/** One bar split into its parts (six at most), with the parts listed under it. */
export function SegmentedBar({ segments }: { segments: readonly Segment[] }) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const shown = segments.filter((segment) => segment.value > 0);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-subtle">
        {shown.map((segment) => (
          <span
            key={segment.key}
            title={`${segment.label} · ${segment.display}`}
            className="block h-full first:rounded-s-full last:rounded-e-full"
            style={{ width: widthOf(segment.value, total), background: segment.color }}
          />
        ))}
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-3 gap-y-1">
        {segments.map((segment) => (
          <li key={segment.key}>
            {withLink(
              segment.link,
              <span className="flex items-center gap-1.5 px-1 py-0.5 text-[12px]">
                <span
                  aria-hidden
                  className="size-2 flex-none rounded-[2px]"
                  style={{ background: segment.color }}
                />
                <span className="truncate text-ink-secondary">{segment.label}</span>
                <span dir="ltr" className="ms-auto font-mono tabular-nums">
                  {segment.display}
                </span>
              </span>,
              '',
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface GridCell {
  value: number;
  display: string;
  color: string;
  link?: MarkLink | undefined;
}

/** A weekday × hour grid of shaded cells, one hue, darker = more. */
export function HeatGrid({
  columns,
  rows,
  cell,
}: {
  columns: readonly { key: string; label: string }[];
  rows: readonly { key: string; label: string }[];
  cell: (row: string, column: string) => GridCell;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-[3px] text-[11px]">
        <thead>
          <tr>
            <th aria-hidden />
            {columns.map((column) => (
              <th key={column.key} scope="col" className="font-medium text-ink-muted">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th
                scope="row"
                dir="ltr"
                className="pe-1 text-end font-mono font-normal whitespace-nowrap text-ink-muted"
              >
                {row.label}
              </th>
              {columns.map((column) => {
                const data = cell(row.key, column.key);
                const content = (
                  <span
                    className={cn(
                      'grid h-6 min-w-8 place-items-center rounded-[4px] font-mono tabular-nums',
                      isDarkStep(data.color) ? 'text-white' : 'text-ink-secondary',
                      data.value === 0 && 'text-transparent',
                    )}
                    style={{ background: data.value === 0 ? 'var(--color-faint)' : data.color }}
                    title={data.display}
                  >
                    {data.value}
                  </span>
                );
                return (
                  <td key={column.key} className="p-0">
                    {data.link ? data.link(content, MARK) : content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
