/** A card's width on the board: a third, two thirds or the whole width. */
export type CardSpan = 1 | 2 | 3;

export interface PackItem {
  id: string;
  span: CardSpan;
  /** Its height as rendered now, in px. */
  height: number;
}

export interface Placement {
  id: string;
  /** Its first column, from the start of the reading direction. */
  column: number;
  span: number;
  top: number;
  height: number;
}

export interface BandLayout {
  placements: Placement[];
  height: number;
}

/** Board columns for a band this wide: thirds, then halves, then one. */
export function columnsFor(width: number): number {
  if (width >= 880) return 3;
  if (width >= 560) return 2;
  return 1;
}

const overlaps = (a: Placement, from: number, to: number, gap: number) =>
  a.top < to + gap && a.top + a.height + gap > from;

const covers = (a: Placement, column: number) => column >= a.column && column < a.column + a.span;

/**
 * Packs a band's cards (in order: most urgent first) into `columns` (spec T1): each takes the
 * highest place its width fits, the leftmost of equals, so a short card slips under a short
 * neighbour instead of leaving a hole. Then each card widens into a column beside it that holds
 * nothing over its height, so a band never ends on an empty strip beside its last card.
 */
export function packBoard(items: readonly PackItem[], columns: number, gap: number): BandLayout {
  const skyline = Array.from({ length: columns }, () => 0);
  const placements: Placement[] = [];
  for (const item of items) {
    const span = Math.min(item.span, columns);
    let best = 0;
    let bestTop = Number.POSITIVE_INFINITY;
    for (let column = 0; column + span <= columns; column += 1) {
      const top = Math.max(...skyline.slice(column, column + span));
      if (top < bestTop) {
        best = column;
        bestTop = top;
      }
    }
    placements.push({ id: item.id, column: best, span, top: bestTop, height: item.height });
    for (let column = best; column < best + span; column += 1) {
      skyline[column] = bestTop + item.height + gap;
    }
  }

  const free = (self: Placement, column: number) =>
    placements.every(
      (other) =>
        other === self ||
        !covers(other, column) ||
        !overlaps(other, self.top, self.top + self.height, gap),
    );
  for (const placement of placements) {
    while (
      placement.column + placement.span < columns &&
      free(placement, placement.column + placement.span)
    ) {
      placement.span += 1;
    }
    while (placement.column > 0 && free(placement, placement.column - 1)) {
      placement.column -= 1;
      placement.span += 1;
    }
  }

  const bottom = Math.max(0, ...placements.map((placement) => placement.top + placement.height));
  return { placements, height: bottom };
}
