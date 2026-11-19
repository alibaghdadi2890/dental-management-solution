import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { type ReactNode, useCallback, useState } from 'react';
import { useSession } from '@/features/auth/session';
import { stockQuery } from './inventory-api';
import { TakeOutContext } from './take-out-context';
import { TakeOutPanel } from './take-out-panel';

/**
 * Mounts the one Take out panel the search opens (search S8), over whatever page is shown, with
 * the item chosen. A new opening remounts it; going to another page closes it.
 */
export function TakeOutProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const href = useRouterState({ select: (state) => state.location.href });
  const [open, setOpen] = useState<{
    id: number;
    itemId: string;
    branchId: string;
    href: string;
  } | null>(null);
  const openTakeOut = useCallback(
    (itemId: string, branchId: string) => {
      setOpen((current) => ({ id: (current?.id ?? 0) + 1, itemId, branchId, href }));
    },
    [href],
  );
  const allowed = session?.tenant != null && session.permissions.includes('inventory:write');
  if (open && (open.href !== href || !allowed)) setOpen(null);
  return (
    <TakeOutContext value={allowed ? openTakeOut : null}>
      {children}
      {open && open.href === href && allowed && (
        <ChosenTakeOut
          key={open.id}
          itemId={open.itemId}
          branchId={open.branchId}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </TakeOutContext>
  );
}

/** The panel waits for the branch's stock (already cached by the search) to choose the item. */
function ChosenTakeOut({
  itemId,
  branchId,
  onClose,
}: {
  itemId: string;
  branchId: string;
  onClose: () => void;
}) {
  const stock = useQuery(stockQuery(branchId));
  if (!stock.data) return null;
  return (
    <TakeOutPanel
      branchId={branchId}
      rows={stock.data.rows}
      initialItemId={itemId}
      onClose={onClose}
    />
  );
}
