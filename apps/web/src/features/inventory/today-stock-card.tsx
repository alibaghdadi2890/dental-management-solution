import type { StockLabelKind } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BoardIcon } from '@/components/board/board-icons';
import { CARD_ACTION, CARD_LINK } from '@/components/board/board-kit';
import { TodayCard } from '@/components/board/today-card';
import { usePermission } from '@/features/auth/use-permission';
import { formatCount } from '@/lib/format';
import { stockTodayQuery } from './inventory-api';
import { LABEL_STYLES, useInventoryWords } from './inventory-words';

/** How often the board asks again: stock moves from other screens and computers too. */
const TODAY_REFETCH_MS = 60_000;

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
 * _To price_ only for whoever manages inventory money (the API sends null otherwise). Whoever
 * receives stock has _Receive_ in the header.
 */
export function TodayStockCard({ branchId }: { branchId: string }) {
  const { t, locale } = useInventoryWords();
  const canReceive = usePermission('inventory:write');
  const today = useQuery({
    ...stockTodayQuery(branchId),
    refetchInterval: TODAY_REFETCH_MS,
    refetchOnWindowFocus: 'always',
  });
  const data = today.data;
  if (!data) return null;
  const lines = LINES.filter((line) => data[line.key] > 0);
  const toPrice = data.toPrice ?? 0;
  if (lines.length === 0 && toPrice === 0) return null;
  return (
    <TodayCard
      id="stock"
      hue="green"
      icon={<BoardIcon name="stock" />}
      title={t('today.title')}
      link={(label) => (
        <Link to="/inventory" search={{ branch: branchId }} className={CARD_LINK}>
          {label}
        </Link>
      )}
      action={
        canReceive ? (
          <Link to="/inventory/receipts/new" search={{ branch: branchId }} className={CARD_ACTION}>
            {t('stock.receive')}
          </Link>
        ) : null
      }
      span={4}
    >
      <ul className="m-0 flex list-none flex-wrap gap-2 px-3.5 py-3">
        {lines.map((line) => (
          <li key={line.key}>
            <Link
              to="/inventory"
              search={{ status: line.status, branch: branchId }}
              className={`inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-[12.5px] hover:underline ${LABEL_STYLES[line.status]}`}
            >
              {t(`label.${line.status}`)}
              <span className="font-mono font-semibold tabular-nums">
                {formatCount(data[line.key], locale)}
              </span>
            </Link>
          </li>
        ))}
        {toPrice > 0 && (
          <li>
            <Link
              to="/inventory"
              search={{ tab: 'receipts', toPrice: true, branch: branchId }}
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-control bg-surface px-2.5 text-[12.5px] hover:underline"
            >
              {t('receipt.toPrice')}
              <span className="font-mono font-semibold tabular-nums">
                {formatCount(toPrice, locale)}
              </span>
            </Link>
          </li>
        )}
      </ul>
    </TodayCard>
  );
}
