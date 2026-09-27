/**
 * Pure pager math for the patients list (design "Pager: numbered buttons (first, last, current
 * ±1, gaps)"). No i18n, no DOM — the component turns `pageRange`'s numbers into the "Showing
 * 11–20 of 54" string via i18n and renders `pageWindow`'s tokens as buttons/ellipses.
 */

/** A page number, or a collapsed run of pages the pager renders as an ellipsis. */
export type PageToken = number | 'gap';

/**
 * The page buttons to render: always page 1 and `last`, always `current` and its immediate
 * neighbours, and a single `'gap'` token for any run of two or more collapsed pages in between.
 * A run of exactly one missing page (e.g. between 6 and 8) is filled in rather than collapsed —
 * showing "…7…" as a lone gap saves nothing over showing "7".
 */
export function pageWindow(current: number, last: number): PageToken[] {
  if (last <= 1) return [1];

  const pages = new Set<number>([1, last, current]);
  if (current - 1 >= 1) pages.add(current - 1);
  if (current + 1 <= last) pages.add(current + 1);

  const sorted = [...pages].sort((a, b) => a - b);
  const result: PageToken[] = [];
  for (const [index, page] of sorted.entries()) {
    const previous = sorted[index - 1];
    if (previous !== undefined) {
      const gapSize = page - previous;
      if (gapSize === 2) {
        result.push(previous + 1);
      } else if (gapSize > 2) {
        result.push('gap');
      }
    }
    result.push(page);
  }
  return result;
}

export interface PageRange {
  /** 1-based index of the first item on this page; 0 when `total` is 0. */
  from: number;
  /** 1-based index of the last item on this page; 0 when `total` is 0. */
  to: number;
  total: number;
  /** Last page number; 1 (not 0) when `total` is 0, so a pager always has at least one page. */
  last: number;
}

/** The numbers behind "Showing {from}–{to} of {total}". */
export function pageRange(page: number, size: number, total: number): PageRange {
  if (total === 0) return { from: 0, to: 0, total: 0, last: 1 };
  return {
    from: (page - 1) * size + 1,
    to: Math.min(page * size, total),
    total,
    last: Math.ceil(total / size),
  };
}
