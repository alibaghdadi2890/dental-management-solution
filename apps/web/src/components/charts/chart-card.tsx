import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CardSkeleton } from '@/components/ui/card';
import { InfoMark } from '@/components/ui/info-mark';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { type ChartTable, downloadTable } from './chart-table';

/** What a card shows besides its chart: its own loading, empty, error and set-aside states. */
export type CardState =
  | { kind: 'ready' }
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'aside'; text: string }
  | { kind: 'error'; error: unknown; onRetry: () => void };

export interface ChartKeyItem {
  label: string;
  color: string;
}

/** A compact key in the title row: only for a chart with two series or more. */
export function ChartKey({ items }: { items: readonly ChartKeyItem[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-muted">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-[2px]" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** A real table of the chart's data: _View as table_, and what a screen reader gets. */
export function DataTable({ table, caption }: { table: ChartTable; caption: string }) {
  return (
    <div className="max-h-[320px] overflow-auto">
      <table className="w-full text-[12.5px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-inner-divider text-ink-muted">
            {table.columns.map((column, index) => (
              <th
                key={column}
                scope="col"
                className={cn('py-1.5 font-medium', index === 0 ? 'text-start' : 'text-end')}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-row-divider last:border-0">
              {row.cells.map((cell, index) =>
                index === 0 ? (
                  <th key={index} scope="row" className="py-1.5 text-start font-normal">
                    {cell}
                  </th>
                ) : (
                  <td key={index} dir="ltr" className="py-1.5 text-end font-mono tabular-nums">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A dashboard card (feature 19, D5): a 2–4 word title with its **!**, the key, a quiet ⋯ menu
 * (_View as table_, and _Export CSV_ for who may export it), and the card's own states. The
 * chart's accessible name states its headline (`summary`); its text alternative is the table.
 */
export function ChartCard({
  title,
  info,
  keyItems = [],
  summary,
  table,
  exportName,
  canExport,
  state,
  className,
  action,
  children,
}: {
  title: string;
  info?: ReactNode;
  keyItems?: readonly ChartKeyItem[];
  /** The headline in words, e.g. "Collected 5,000 in November". */
  summary?: string;
  table?: ChartTable | undefined;
  exportName?: string;
  canExport?: boolean;
  state: CardState;
  className?: string;
  /** A control in the title row (a switch). */
  action?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation('dashboards');
  const titleId = useId();
  const [asTable, setAsTable] = useState(false);
  const ready = state.kind === 'ready';
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'flex min-w-0 flex-col rounded-xl border border-border bg-surface px-[18px] py-4 break-inside-avoid',
        className,
      )}
    >
      <div className="mb-3 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-1.5">
          <h2 id={titleId} className="m-0 text-[14px] leading-none font-semibold">
            {title}
          </h2>
          {info && <InfoMark about={title}>{info}</InfoMark>}
        </div>
        {ready && <ChartKey items={keyItems} />}
        <div className="ms-auto flex items-center gap-2">
          {ready && action}
          {ready && table && (
            <Menu>
              <MenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t('card.menu', { title })}
                  className="grid size-7 cursor-pointer place-items-center rounded-md text-ink-muted hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-ring print:hidden"
                >
                  <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <circle cx="3" cy="8" r="1.4" />
                    <circle cx="8" cy="8" r="1.4" />
                    <circle cx="13" cy="8" r="1.4" />
                  </svg>
                </button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem
                  onSelect={() => {
                    setAsTable((value) => !value);
                  }}
                >
                  {asTable ? t('card.viewAsChart') : t('card.viewAsTable')}
                </MenuItem>
                {canExport && exportName && (
                  <MenuItem
                    onSelect={() => {
                      downloadTable(table, exportName);
                    }}
                  >
                    {t('card.exportCsv')}
                  </MenuItem>
                )}
              </MenuContent>
            </Menu>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 animate-fadein motion-reduce:animate-none">
        {state.kind === 'loading' && <CardSkeleton label={t('card.loading', { title })} />}
        {state.kind === 'empty' && (
          <p className="py-6 text-center text-[13px] text-ink-muted">{t('card.empty')}</p>
        )}
        {state.kind === 'aside' && (
          <p className="py-6 text-center text-[13px] text-ink-muted">{state.text}</p>
        )}
        {state.kind === 'error' && <CardError error={state.error} onRetry={state.onRetry} />}
        {ready &&
          (asTable && table ? (
            <DataTable table={table} caption={title} />
          ) : (
            <div role="figure" aria-label={summary ?? title}>
              {children}
              {table && (
                <div className="sr-only">
                  <DataTable table={table} caption={title} />
                </div>
              )}
            </div>
          ))}
      </div>
    </section>
  );
}

/** A card's failure, in the app's error style, with _Try again_; the other cards stay. */
export function CardError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation('dashboards');
  const { t: common } = useTranslation('common');
  const forbidden = error instanceof ApiError && error.status === 403;
  return (
    <div role="alert" className="flex flex-col items-center gap-2 py-5 text-center">
      <span className="grid size-7 place-items-center rounded-full border border-danger-border bg-danger-bg text-[12px] font-bold text-danger">
        {'!'}
      </span>
      <p className="text-[12.5px] text-ink-tertiary">
        {forbidden ? common('forbidden.title') : t('card.error')}
      </p>
      {!forbidden && (
        <button
          type="button"
          onClick={onRetry}
          className="cursor-pointer text-[12.5px] font-medium text-primary hover:underline"
        >
          {common('tryAgain')}
        </button>
      )}
    </div>
  );
}
