import type { StockLabel as Label } from '@dcm/contracts';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { LABEL_STYLES, useInventoryWords } from './inventory-words';

/**
 * The one status label of an item in a branch (B6), the same component and words wherever it
 * appears: the most urgent label (the API sends them in that order) and `+n` for the others,
 * which the tooltip names. Nothing when the item needs nothing. `plain` leaves the tooltip out,
 * where the pill sits inside a row that is one target (the search).
 */
export function StockLabel({
  labels,
  plain = false,
}: {
  labels: readonly Label[];
  plain?: boolean;
}) {
  const { labelText } = useInventoryWords();
  const [first, ...rest] = labels;
  if (!first) return null;
  const pill = (
    <span
      className={cn(
        'inline-flex h-[22px] flex-none items-center gap-1 rounded-[5px] border px-2 text-[11.5px] leading-none whitespace-nowrap',
        LABEL_STYLES[first.kind],
      )}
    >
      {labelText(first)}
      {rest.length > 0 && <span className="font-mono opacity-80">+{rest.length}</span>}
    </span>
  );
  if (rest.length === 0 || plain) return pill;
  return (
    <Tooltip label={labels.map(labelText).join(' · ')}>
      <span
        tabIndex={0}
        className="inline-flex rounded-[5px] focus-visible:outline-2 focus-visible:outline-ring"
      >
        {pill}
      </span>
    </Tooltip>
  );
}
