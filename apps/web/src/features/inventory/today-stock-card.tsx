import type { StockLabelKind } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { formatCount } from '@/lib/format';
import { stockTodayQuery } from './inventory-api';
import { LABEL_STYLES, useInventoryWords } from './inventory-words';

const LINES: readonly {
  key: 'out' | 'expired' | 'low' | 'expiring' | 'toCount';
  status: StockLabelKind;
}[] = [
  { key: 'out', status: 'out' },
  { key: 'expired', status: 'expired' },
  { key: 'low', status: 'low' },
  { key: 'expiring', status: 'expiring' },
  { key: 'toCount', status: 'to_count' },
];

/**
 * Today's Stock card (C2), for the current branch: one line per reason with its count, each a
 * link to the filtered list; a line goes at zero, and the card is absent with nothing to show.
 * _To price_ only for whoever manages inventory money (the API sends null otherwise).
 */
export function TodayStockCard({ branchId }: { branchId: string }) {
  const { t, locale } = useInventoryWords();
  const headingId = useId();
  const today = useQuery(stockTodayQuery(branchId));
  const data = today.data;
  if (!data) return null;
  const lines = LINES.filter((line) => data[line.key] > 0);
  const toPrice = data.toPrice ?? 0;
  if (lines.length === 0 && toPrice === 0) return null;
  return (
    <section aria-labelledby={headingId} className="mb-6">
      <h2
        id={headingId}
        className="m-0 mb-2.5 text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal"
      >
        {t('today.title')}
      </h2>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {lines.map((line) => (
          <li key={line.key}>
            <Link
              to="/inventory"
              search={{ status: line.status, branch: branchId }}
              className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] hover:underline ${LABEL_STYLES[line.status]}`}
            >
              {t(`label.${line.status}`)}
              <span className="font-mono tabular-nums">{formatCount(data[line.key], locale)}</span>
            </Link>
          </li>
        ))}
        {toPrice > 0 && (
          <li>
            <Link
              to="/inventory"
              search={{ tab: 'receipts', toPrice: true, branch: branchId }}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-control bg-surface px-3 text-[13px] hover:underline"
            >
              {t('receipt.toPrice')}
              <span className="font-mono tabular-nums">{formatCount(toPrice, locale)}</span>
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}
