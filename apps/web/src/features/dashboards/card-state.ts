import type { UseQueryResult } from '@tanstack/react-query';
import type { CardState } from '@/components/charts';

/** A card's state from its query: loading, failed (with _Try again_), empty, or ready. */
export function stateOf<T>(
  query: Pick<UseQueryResult<T>, 'data' | 'isPending' | 'isError' | 'error' | 'refetch'>,
  isEmpty: (data: T) => boolean = () => false,
): CardState {
  if (query.isError) {
    return {
      kind: 'error',
      error: query.error,
      onRetry: () => {
        void query.refetch();
      },
    };
  }
  if (query.isPending || query.data === undefined) return { kind: 'loading' };
  return isEmpty(query.data) ? { kind: 'empty' } : { kind: 'ready' };
}

/** The tile's state from its query. */
export function tileState(
  query: Pick<UseQueryResult, 'data' | 'isPending' | 'isError'>,
): 'loading' | 'error' | 'ready' {
  if (query.isError) return 'error';
  return query.isPending || query.data === undefined ? 'loading' : 'ready';
}

/** Money text as a number of whole units, for bar widths and chart scales only. */
export const amountOf = (amount: string): number => Number(amount);
