import { type RefObject, useEffect } from 'react';

const GLIDE = { duration: 380, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' } as const;

type Spot = { x: number; y: number };

/**
 * Cards glide to their new places when a card or a row comes or goes (FLIP): whenever the board's
 * DOM gains or loses nodes, every card that moved is played back from where it was. Places are
 * offsets inside the board, which transforms (a bloom running) leave alone. Reduced motion: none.
 */
export function useFlip(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof MutationObserver === 'undefined') return;
    const reduced =
      // jsdom (the specs) has no matchMedia.
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    const measure = () => {
      const spots = new Map<HTMLElement, Spot>();
      for (const card of root.querySelectorAll<HTMLElement>('[data-board-card]')) {
        spots.set(card, { x: card.offsetLeft, y: card.offsetTop });
      }
      return spots;
    };
    let last = measure();
    const mutated = new MutationObserver(() => {
      const next = measure();
      if (!reduced?.matches) {
        for (const [card, at] of next) {
          const was = last.get(card);
          if (!was || typeof card.animate !== 'function') continue;
          const dx = was.x - at.x;
          const dy = was.y - at.y;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
          card.animate(
            [{ transform: `translate(${String(dx)}px, ${String(dy)}px)` }, { transform: 'none' }],
            GLIDE,
          );
        }
      }
      last = next;
    });
    // A band shown or hidden, a card collapsed: attribute changes that move cards too.
    mutated.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'data-collapsed'],
    });
    // A row sliding open, a window resized: the cards settle where they are, with no glide.
    const settle = () => {
      last = measure();
    };
    const resized = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(settle);
    resized?.observe(root);
    root.addEventListener('animationend', settle);
    return () => {
      mutated.disconnect();
      resized?.disconnect();
      root.removeEventListener('animationend', settle);
    };
  }, [ref]);
}

/** Whether `root` holds an element matching `selector`, kept up to date as its DOM changes. */
export function observeHas(
  root: HTMLElement,
  selector: string,
  onChange: (has: boolean) => void,
): () => void {
  let has = root.querySelector(selector) !== null;
  onChange(has);
  if (typeof MutationObserver === 'undefined') return () => undefined;
  const observer = new MutationObserver(() => {
    const next = root.querySelector(selector) !== null;
    if (next !== has) {
      has = next;
      onChange(next);
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
  };
}
