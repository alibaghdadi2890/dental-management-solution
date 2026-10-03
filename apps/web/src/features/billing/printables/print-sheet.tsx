import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/session';
import { branchesQuery } from '@/features/tenancy/tenancy-api';
import { cn } from '@/lib/utils';

/**
 * A printable document (feature 5, B9; POC Invoice / Receipt / Quote): a toolbar hidden in print
 * (Back, the document name, "A4 · prints one page", Print / PDF) over an A4 sheet — 210 × 297 mm,
 * left to right whatever the UI direction (RTL printables are out of scope). The browser prints
 * it or saves it as a PDF; nothing is rendered on the server.
 */
export function PrintSheet({
  title,
  number,
  state,
  watermark,
  multiPage = false,
  children,
}: {
  title: string;
  /** `RCT-000012`, `INV-000123`, `EST-…`. */
  number: string;
  /** Shown instead of the body while loading or after a failure. */
  state?: 'loading' | 'error' | undefined;
  /** A large diagonal word over the sheet ("VOID"). */
  watermark?: string | undefined;
  /** May run over one A4 page (a family statement): no "one page" promise, no page count. */
  multiPage?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation('printables');
  return (
    <div dir="ltr" className="min-h-full bg-subtle py-6 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex w-[210mm] max-w-full items-center gap-3 px-2 print:hidden">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            if (window.history.length > 1) window.history.back();
            else window.close();
          }}
        >
          {t('back')}
        </Button>
        <span className="text-[13px] font-semibold">{title}</span>
        <span className="text-[12px] text-ink-muted">
          {multiPage ? t('formatMulti') : t('format')}
        </span>
        <Button
          variant="primary"
          size="sm"
          className="ms-auto"
          disabled={state !== undefined}
          onClick={() => {
            window.print();
          }}
        >
          {t('print')}
        </Button>
      </div>
      <article className="relative mx-auto box-border flex min-h-[297mm] w-[210mm] max-w-full flex-col overflow-hidden bg-white px-[16mm] py-[15mm] text-[12px] leading-snug text-ink shadow-[0_6px_24px_rgba(27,26,31,.12)] print:shadow-none">
        {watermark && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 grid -rotate-[24deg] place-items-center text-[120px] font-bold tracking-[0.2em] text-danger/10"
          >
            {watermark}
          </span>
        )}
        <header className="mb-7 flex items-start justify-between gap-6 border-b border-ink pb-5">
          <ClinicBlock />
          <div className="text-end">
            <h1 className="m-0 text-[22px] leading-tight font-semibold">{title}</h1>
            <p className="m-0 mt-1 font-mono text-[12.5px] text-ink-secondary">{number}</p>
          </div>
        </header>
        {state ? (
          <p role={state === 'error' ? 'alert' : 'status'} className="text-ink-muted">
            {state === 'error' ? t('failed') : t('loading')}
          </p>
        ) : (
          <div className="flex flex-1 flex-col">{children}</div>
        )}
        <footer className="mt-8 flex justify-between border-t border-border pt-3 text-[10.5px] text-ink-muted">
          <span>{t('footer')}</span>
          {!multiPage && <span>{t('page')}</span>}
        </footer>
      </article>
    </div>
  );
}

/** The clinic and the active branch's address and phone. */
function ClinicBlock() {
  const { data: session } = useSession();
  const branches = useQuery(branchesQuery());
  const branch = branches.data?.find((candidate) => candidate.id === session?.branch?.id);
  return (
    <div>
      <p className="m-0 text-[15px] font-semibold">{session?.tenant?.name}</p>
      {branch && (
        <p className="m-0 mt-1 text-[11.5px] leading-snug whitespace-pre-line text-ink-secondary">
          {[branch.name, branch.address, branch.phone].filter(Boolean).join('\n')}
        </p>
      )}
    </div>
  );
}

/** The parties row: Patient · Bill to / Visit / Prepared by · …, as labelled columns. */
export function Parties({
  columns,
}: {
  columns: { label: string; lines: (string | null | undefined)[] }[];
}) {
  return (
    <section className="mb-6 grid grid-cols-3 gap-6">
      {columns.map((column) => (
        <div key={column.label}>
          <p className="m-0 mb-1 text-[10px] font-medium tracking-[.08em] text-ink-muted uppercase">
            {column.label}
          </p>
          {column.lines.filter(Boolean).map((line, index) => (
            <p key={index} className={cn('m-0', index === 0 && 'font-semibold')}>
              {line}
            </p>
          ))}
        </div>
      ))}
    </section>
  );
}

/** An items table: header labels and rows of cells; `numeric` columns are end-aligned Mono. */
export function ItemsTable({
  headers,
  rows,
  numeric,
}: {
  headers: string[];
  rows: ReactNode[][];
  numeric: number[];
}) {
  return (
    <table className="mb-5 w-full border-collapse">
      <thead>
        <tr>
          {headers.map((header, index) => (
            <th
              key={header}
              className={cn(
                'border-b border-border-control py-2 text-[10px] font-medium tracking-[.08em] text-ink-muted uppercase',
                numeric.includes(index) ? 'text-end' : 'text-start',
              )}
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, index) => (
              <td
                key={index}
                className={cn(
                  'border-b border-inner-divider py-2 align-top',
                  numeric.includes(index) && 'text-end font-mono tabular-nums',
                )}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The totals block: label/amount lines, the last one bold above a 1px ink rule. */
export function Totals({
  lines,
}: {
  lines: { label: string; amount: string; strong?: boolean }[];
}) {
  return (
    <dl className="m-0 ms-auto w-[78mm]">
      {lines.map((line) => (
        <div
          key={line.label}
          className={cn(
            'flex justify-between gap-4 py-1',
            line.strong && 'mt-1 border-t border-ink pt-2 text-[14px] font-bold',
          )}
        >
          <dt>{line.label}</dt>
          <dd className="m-0 font-mono tabular-nums">{line.amount}</dd>
        </div>
      ))}
    </dl>
  );
}
