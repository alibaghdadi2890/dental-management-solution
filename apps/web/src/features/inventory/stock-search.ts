import type { StockRow } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { stockQuery } from './inventory-api';
import { matchesItem } from './item-match';

/** Stock items the search shows (S4). */
export const STOCK_SHOWN = 3;

/**
 * The search's Stock group (S5): the branch's stock, loaded once when the search opens and
 * filtered on the device by name or code; inactive items are left out. `settled` once the stock
 * has answered, or failed (a failure only hides the group). No branch, no group.
 */
export function useStockSearch(query: string, branchId: string | null) {
  const stock = useQuery({ ...stockQuery(branchId ?? ''), enabled: branchId !== null });
  const searching = query !== '';
  const rows: StockRow[] =
    branchId !== null && searching
      ? (stock.data?.rows ?? [])
          .filter((row) => row.active && matchesItem(row, query))
          .slice(0, STOCK_SHOWN)
      : [];
  const settled = branchId === null || !searching || stock.isSuccess || stock.isError;
  return { rows, settled };
}
