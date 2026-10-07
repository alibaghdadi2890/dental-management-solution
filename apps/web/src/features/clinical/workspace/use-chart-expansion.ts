import { useCallback, useRef, useState } from 'react';

/** The chart card's expanded state and its toggle, as the card takes them. */
export interface ChartExpansion {
  expanded: boolean;
  toggle: () => void;
  /** True once after each toggle: the card that asks is the one the toggle produced, and it
   * takes the focus (see `useChartExpansion`). */
  consumeToggle: () => boolean;
}

/**
 * Whether the dental chart card is expanded across the page. A page that moves the card to its
 * own full-width row when it expands draws a new card, with a new toggle button: the new card
 * asks `consumeToggle` once it is on screen, gives its button the focus the old one had and
 * brings itself into view, so a keyboard user stays where they were.
 */
export function useChartExpansion(): ChartExpansion {
  const [expanded, setExpanded] = useState(false);
  const toggled = useRef(false);

  const toggle = useCallback(() => {
    toggled.current = true;
    setExpanded((current) => !current);
  }, []);

  const consumeToggle = useCallback(() => {
    const wasToggled = toggled.current;
    toggled.current = false;
    return wasToggled;
  }, []);

  return { expanded, toggle, consumeToggle };
}
