import { describe, expect, it } from 'vitest';
import { columnsFor, packBoard, type PackItem } from './board-layout';

const GAP = 12;
const item = (id: string, span: PackItem['span'], height: number): PackItem => ({
  id,
  span,
  height,
});
const where = (items: PackItem[], columns = 3) =>
  Object.fromEntries(
    packBoard(items, columns, GAP).placements.map((p) => [p.id, [p.column, p.span, p.top]]),
  );

describe('packBoard', () => {
  it('slips short cards under a short neighbour beside a tall one', () => {
    // The Today band of the screenshot: the timeline, a tall follow-ups list, then two short cards.
    const placed = where([
      item('schedule', 2, 170),
      item('follow-ups', 1, 680),
      item('openings', 1, 200),
      item('coming-up', 1, 260),
    ]);
    expect(placed).toEqual({
      schedule: [0, 2, 0],
      'follow-ups': [2, 1, 0],
      openings: [0, 1, 182],
      'coming-up': [1, 1, 182],
    });
  });

  it('widens a lone card, and the last card of a short row, to close the strip beside it', () => {
    expect(where([item('next', 1, 220)])).toEqual({ next: [0, 3, 0] });
    expect(where([item('waiting', 1, 300), item('chair', 1, 200), item('next', 1, 220)])).toEqual({
      waiting: [0, 1, 0],
      chair: [1, 1, 0],
      next: [2, 1, 0],
    });
    expect(where([item('lab', 2, 300), item('stock', 1, 120), item('expenses', 1, 260)])).toEqual({
      lab: [0, 2, 0],
      stock: [2, 1, 0],
      expenses: [2, 1, 132],
    });
  });

  it('takes the highest place, so a wide card goes where its columns are lowest', () => {
    const placed = where([item('waiting', 1, 300), item('next', 1, 150), item('checkout', 2, 200)]);
    // Checkout under Next (columns 1–2), and Next widens over the empty column above it.
    expect(placed.checkout).toEqual([1, 2, 162]);
    expect(placed.next).toEqual([1, 2, 0]);
    expect(placed.waiting).toEqual([0, 1, 0]);
  });

  it('keeps every card inside fewer columns, and reports the band height', () => {
    const layout = packBoard([item('schedule', 2, 170), item('chair', 1, 100)], 1, GAP);
    expect(layout.placements.map((p) => [p.column, p.span, p.top])).toEqual([
      [0, 1, 0],
      [0, 1, 182],
    ]);
    expect(layout.height).toBe(282);
  });
});

describe('columnsFor', () => {
  it('is thirds on a wide board, halves in between, one when narrow', () => {
    expect([1200, 880, 879, 560, 559].map(columnsFor)).toEqual([3, 3, 2, 2, 1]);
  });
});
