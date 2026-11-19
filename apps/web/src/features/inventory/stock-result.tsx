import type { StockRow } from '@dcm/contracts';
import { useInventoryWords } from './inventory-words';
import { StockLabel } from './stock-label';

/** A stock item in the search (S6): name, code, what is on hand and its label. */
export function StockResult({ row }: { row: StockRow }) {
  const { quantity } = useInventoryWords();
  return (
    <>
      <span
        aria-hidden
        className="grid size-[34px] flex-none place-items-center rounded-lg border border-border bg-subtle text-ink-secondary"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        >
          <path d="M2.5 5 8 2.2 13.5 5v6L8 13.8 2.5 11z" />
          <path d="M2.5 5 8 7.8 13.5 5M8 7.8v6" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] leading-[1.3] font-medium">{row.name}</span>
        <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs leading-[1.4] text-ink-muted">
          {row.code && (
            <span dir="ltr" className="font-mono">
              {row.code}
            </span>
          )}
          <span className="tabular-nums">{quantity(row.onHand, row)}</span>
        </span>
      </span>
      <StockLabel labels={row.labels} plain />
    </>
  );
}
