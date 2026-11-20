import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { CardShown, useBoard } from './board-kit';

export type CardHue = 'indigo' | 'amber' | 'rose' | 'violet' | 'sky' | 'teal' | 'green' | 'orange';
/** Its width on the 12-column board; on the 6-column board 6 and up take 6, the rest 3. */
export type CardSpan = 3 | 4 | 5 | 6 | 8 | 12;

const SPANS: Record<CardSpan, string> = {
  3: '@2xl:col-span-3 @4xl:col-span-3',
  4: '@2xl:col-span-3 @4xl:col-span-4',
  5: '@2xl:col-span-3 @4xl:col-span-5',
  6: '@2xl:col-span-6 @4xl:col-span-6',
  8: '@2xl:col-span-6 @4xl:col-span-8',
  12: '@2xl:col-span-6 @4xl:col-span-12',
};

/**
 * A card of the Today board: a header in its hue (a solid badge, the title — a link to its screen
 * when it has one — a count, at most one quick action, collapse), then its rows. It blooms when it
 * mounts after the first load, and its count bumps when it changes. Its region is named
 * "Title · count", as the board's lanes always were.
 */
export function TodayCard({
  id,
  hue,
  icon,
  title,
  link,
  count,
  regionLabel,
  extra,
  action,
  span,
  children,
}: {
  /** Stable across renders and users: the key its collapsed state is kept under. */
  id: string;
  hue: CardHue;
  icon: ReactNode;
  title: string;
  /** Wraps the title in a link to its screen. */
  link?: (label: ReactNode) => ReactNode;
  count?: number | undefined;
  /** The region's name when it is not "Title · count". */
  regionLabel?: string;
  /** Beside the count: chips, an info mark. */
  extra?: ReactNode;
  /** The quick action, at the end of the header. */
  action?: ReactNode;
  span: CardSpan;
  children: ReactNode;
}) {
  const { t } = useTranslation('common');
  const { armed, isCollapsed, toggle } = useBoard();
  const [arrived] = useState(armed);
  const collapsed = isCollapsed(id);
  // On screen once mounted; rows shown again by expanding the card have not arrived.
  const shown = useRef(false);
  useEffect(() => {
    shown.current = !collapsed;
  }, [collapsed]);
  // The count bumps when it changes on screen (not on the first load).
  const [seen, setSeen] = useState(count);
  const [bumps, setBumps] = useState(0);
  if (seen !== count) {
    setSeen(count);
    if (armed && seen !== undefined && count !== undefined) setBumps(bumps + 1);
  }
  const label = (
    <span className="text-[11px] leading-tight font-semibold tracking-[.05em] uppercase [&:lang(ar)]:tracking-normal">
      {title}
    </span>
  );

  return (
    <section
      data-board-card={id}
      data-hue={hue}
      {...(collapsed ? { 'data-collapsed': '' } : {})}
      aria-label={regionLabel ?? (count === undefined ? title : `${title} · ${String(count)}`)}
      className={cn('board-card col-span-1', SPANS[span], arrived && 'board-card-arrive')}
    >
      <div className="board-card-head">
        <span aria-hidden className="board-badge">
          {icon}
        </span>
        <h3 className="m-0 min-w-0">{link ? link(label) : label}</h3>
        {count === undefined ? null : (
          <span key={bumps} className={cn('board-count', bumps > 0 && 'board-bump')}>
            {count}
          </span>
        )}
        {extra}
        <span className="ms-auto flex items-center gap-1">
          {action}
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={t(collapsed ? 'board.expand' : 'board.collapse', { title })}
            onClick={() => {
              toggle(id);
            }}
            className="grid size-7 cursor-pointer place-items-center rounded-md text-current opacity-70 hover:bg-surface hover:opacity-100"
          >
            <svg
              aria-hidden
              viewBox="0 0 16 16"
              className={cn(
                'size-3.5 transition-transform',
                collapsed && '-rotate-90 rtl:rotate-90',
              )}
            >
              <path
                d="M4 6l4 4 4-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </span>
      </div>
      {collapsed ? null : <CardShown value={shown}>{children}</CardShown>}
    </section>
  );
}
