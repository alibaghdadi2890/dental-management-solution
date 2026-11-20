import { createContext, useContext, useState } from 'react';

/** What the board tells its cards: whether the first load is over, and who collapsed what. */
export interface BoardState {
  /** The first load is over: what mounts from now on arrives (and animates). */
  armed: boolean;
  isCollapsed: (cardId: string) => boolean;
  toggle: (cardId: string) => void;
}

export const BoardContext = createContext<BoardState>({
  armed: false,
  isCollapsed: () => false,
  toggle: () => undefined,
});

export const useBoard = () => useContext(BoardContext);

/** Whether the card was already on screen: a row mounting then has arrived. */
export const CardShown = createContext<{ current: boolean } | null>(null);

/**
 * The class for a row of a board card: it slides open in the card's hue when it mounts while its
 * card was already on screen, after the first load. Outside a board card, nothing.
 */
export function useRowArrival(): string {
  const { armed } = useBoard();
  const shown = useContext(CardShown);
  const [arrived] = useState(() => armed && shown?.current === true);
  return arrived ? 'board-row-arrive' : '';
}

/** What every card carries, so the board can find its cards in its own DOM. */
export const CARD_SELECTOR = '[data-board-card]';

/** For a card title's link: the card's ink, underlined on hover. */
export const CARD_LINK = 'rounded-sm text-current hover:underline';

/** The header's quick action (a link or a button), in the card's ink. */
export const CARD_ACTION =
  'inline-flex h-7 cursor-pointer items-center rounded-md border border-(--hue-border) bg-surface px-2 text-[11.5px] font-semibold text-(--hue-ink) hover:border-(--hue)';

/** A row's main action, in its card's hue (for a `Button`'s `className`). */
export const HUE_BUTTON = 'board-hue-button';
