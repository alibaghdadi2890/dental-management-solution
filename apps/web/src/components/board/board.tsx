import { useIsFetching } from '@tanstack/react-query';
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/utils';
import { BoardContext, type BoardState, CARD_SELECTOR } from './board-kit';
import { observeHas, useFlip } from './use-flip';
import './board.css';

/** No fetch for this long after the board mounted: what is on screen is the first load. */
const SETTLE_MS = 300;

const storageKey = (userId: string) => `dcm.today.collapsed.${userId}`;

function readCollapsed(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Armed once nothing has been fetched for `SETTLE_MS`: the queries of the first load are back. */
function useArmed(): boolean {
  const fetching = useIsFetching();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (armed || fetching > 0) return;
    const timer = setTimeout(() => {
      setArmed(true);
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [armed, fetching]);
  return armed;
}

/** Whether the element holds a card, as its DOM changes: no card has to report it is empty. */
function useHasCard(ref: RefObject<HTMLElement | null>): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    const root = ref.current;
    return root ? observeHas(root, CARD_SELECTOR, setHas) : undefined;
  }, [ref]);
  return has;
}

/**
 * The Today board: its bands, the glide between card places, the first load (`loading` until a
 * card has rendered) and the all-clear line (`empty`, once settled with no card at all). Each user
 * collapses cards for themselves, kept in this browser.
 */
export function Board({
  userId,
  loading,
  empty,
  children,
}: {
  userId: string;
  loading: ReactNode;
  empty: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const armed = useArmed();
  const hasCard = useHasCard(ref);
  useFlip(ref);
  const [collapsed, setCollapsed] = useState(() => readCollapsed(userId));
  const toggle = useCallback(
    (cardId: string) => {
      setCollapsed((current) => {
        const next = new Set(current);
        if (!next.delete(cardId)) next.add(cardId);
        try {
          localStorage.setItem(storageKey(userId), JSON.stringify([...next]));
        } catch {
          // Storage full or blocked: collapsing still works for this visit.
        }
        return next;
      });
    },
    [userId],
  );
  const state = useMemo<BoardState>(
    () => ({ armed, isCollapsed: (cardId) => collapsed.has(cardId), toggle }),
    [armed, collapsed, toggle],
  );
  return (
    <BoardContext value={state}>
      <div ref={ref} className="@container relative flex flex-col gap-5">
        {children}
      </div>
      {!hasCard && (armed ? empty : loading)}
    </BoardContext>
  );
}

/** One band of the board under its quiet label; hidden, label and all, while it holds no card. */
export function Band({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const has = useHasCard(ref);
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} hidden={!has}>
      <h2
        id={headingId}
        className="m-0 mb-2 px-0.5 text-[10.5px] leading-none font-semibold tracking-[.08em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal"
      >
        {label}
      </h2>
      <div
        ref={ref}
        className={cn('grid grid-cols-1 items-start gap-3', '@2xl:grid-cols-6 @4xl:grid-cols-12')}
      >
        {children}
      </div>
    </div>
  );
}
