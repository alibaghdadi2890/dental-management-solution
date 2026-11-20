import { useIsFetching } from '@tanstack/react-query';
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { cn } from '@/lib/utils';
import { BandContext, BoardContext, type BoardState, CARD_SELECTOR } from './board-kit';
import { type BandLayout, type CardSpan, columnsFor, packBoard } from './board-layout';
import { observeHas } from './observe-has';
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
 * The Today board: its bands, the first load (`loading` until a
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
      <div
        ref={ref}
        {...(armed ? { 'data-armed': '' } : {})}
        className="@container board relative flex flex-col gap-5"
      >
        {children}
      </div>
      {!hasCard && (armed ? empty : loading)}
    </BoardContext>
  );
}

/** Between cards, both ways (px). */
const GAP = 12;

interface Packed extends BandLayout {
  width: number;
  columns: number;
  /** Placed for the first time by this pack: they take their place without gliding there. */
  fresh: ReadonlySet<string>;
}

const samePack = (a: Packed | null, b: Omit<Packed, 'fresh'>) =>
  a !== null &&
  a.width === b.width &&
  a.height === b.height &&
  a.placements.length === b.placements.length &&
  a.placements.every((p, index) => {
    const q = b.placements[index];
    return (
      q !== undefined &&
      p.id === q.id &&
      p.column === q.column &&
      p.span === q.span &&
      p.top === q.top
    );
  });

/** The band's cards as they are in the DOM: in order, with their width and height now. */
function measure(root: HTMLElement): Omit<Packed, 'fresh'> {
  const width = root.clientWidth;
  const columns = columnsFor(width);
  const cards = [...root.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement && 'boardCard' in child.dataset,
  );
  const layout = packBoard(
    cards.map((card) => ({
      id: card.dataset.boardCard ?? '',
      span: (Number(card.dataset.span) || 1) as CardSpan,
      height: card.offsetHeight,
    })),
    columns,
    GAP,
  );
  return { ...layout, width, columns };
}

/**
 * Packs the band's cards (spec T1): measures them whenever one comes, goes or changes size, and
 * places each where `packBoard` says, before the screen paints. Null until first measured.
 */
function usePack(ref: RefObject<HTMLDivElement | null>): Packed | null {
  const [packed, setPacked] = useState<Packed | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const run = () => {
      const next = measure(root);
      flushSync(() => {
        setPacked((current) => {
          if (samePack(current, next)) return current;
          const before = new Set(current?.placements.map((p) => p.id));
          const fresh = new Set(next.placements.filter((p) => !before.has(p.id)).map((p) => p.id));
          return { ...next, fresh };
        });
      });
    };
    run();
    const resized = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(run);
    const watch = () => {
      resized?.disconnect();
      resized?.observe(root);
      for (const child of root.children) resized?.observe(child);
    };
    watch();
    const mutated =
      typeof MutationObserver === 'undefined'
        ? undefined
        : new MutationObserver(() => {
            watch();
            run();
          });
    mutated?.observe(root, { childList: true });
    return () => {
      resized?.disconnect();
      mutated?.disconnect();
    };
  }, [ref]);
  return packed;
}

/**
 * One band of the board under its quiet label; hidden, label and all, while it holds no card.
 * Its cards are packed into thirds (halves, or one column, when narrow): each takes the highest
 * place it fits, in order, and widens over an empty column beside it.
 */
export function Band({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const has = useHasCard(ref);
  const packed = usePack(ref);
  const headingId = useId();
  const placement = useMemo(() => {
    if (!packed || packed.width === 0) return null;
    const column = (packed.width - GAP * (packed.columns - 1)) / packed.columns;
    const byId = new Map(packed.placements.map((p) => [p.id, p]));
    const widthOf = (span: number) => span * column + (span - 1) * GAP;
    return {
      styleOf: (cardId: string, span: number): CSSProperties => {
        const at = byId.get(cardId);
        if (!at) {
          // Not placed yet: laid out at its own width, unseen, so its height can be measured.
          return {
            position: 'absolute',
            top: 0,
            insetInlineStart: 0,
            width: widthOf(Math.min(span, packed.columns)),
            visibility: 'hidden',
          };
        }
        return {
          position: 'absolute',
          top: at.top,
          insetInlineStart: at.column * (column + GAP),
          width: widthOf(at.span),
          ...(packed.fresh.has(cardId) ? { transition: 'none' } : {}),
        };
      },
    };
  }, [packed]);
  return (
    <div role="group" aria-labelledby={headingId} hidden={!has}>
      <h2
        id={headingId}
        className="m-0 mb-2 px-0.5 text-[10.5px] leading-none font-semibold tracking-[.08em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal"
      >
        {label}
      </h2>
      <BandContext value={placement}>
        <div
          ref={ref}
          style={placement ? { height: packed?.height } : undefined}
          className={cn(
            'board-band-grid',
            placement ? 'relative' : 'grid grid-cols-1 items-start gap-3 @2xl:grid-cols-3',
          )}
        >
          {children}
        </div>
      </BandContext>
    </div>
  );
}
