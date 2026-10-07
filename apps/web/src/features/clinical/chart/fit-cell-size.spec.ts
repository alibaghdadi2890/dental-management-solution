import { describe, expect, it } from 'vitest';
import { chartWidth, EXPANDED_MAX_CELL, fitCellSize, FULL_CELL } from './fit-cell-size';

const permanent = { mode: 'surface', columns: 16, withAreas: false } as const;

describe('chartWidth', () => {
  it('is the columns, the gaps between them, the markers and the padding', () => {
    // 16 × 40 px glyphs + 15 × 5 px gaps + 2 × 26 px markers + 2 × 6 px padding.
    expect(chartWidth({ ...permanent, size: 12 })).toBe(779);
  });

  it('adds each jaw’s border and padding when the chart has jaw bars', () => {
    expect(chartWidth({ ...permanent, withAreas: true, size: 12 })).toBe(779 + 14);
  });
});

describe('fitCellSize', () => {
  it('keeps the full chart’s 12 px when the space is too narrow for more', () => {
    expect(fitCellSize({ ...permanent, available: 400 })).toBe(FULL_CELL);
    expect(fitCellSize({ ...permanent, available: 779 })).toBe(FULL_CELL);
  });

  it('grows the cell with the space, a pixel at a time', () => {
    const width13 = chartWidth({ ...permanent, size: 13 });
    expect(fitCellSize({ ...permanent, available: width13 - 1 })).toBe(12);
    expect(fitCellSize({ ...permanent, available: width13 })).toBe(13);
    expect(fitCellSize({ ...permanent, available: chartWidth({ ...permanent, size: 17 }) })).toBe(
      17,
    );
  });

  it('never grows past 20 px, however wide the space', () => {
    expect(fitCellSize({ ...permanent, available: 4000 })).toBe(EXPANDED_MAX_CELL);
  });

  it('fits the result: the chart at the returned size is no wider than the space', () => {
    for (const mode of ['surface', 'simple'] as const) {
      for (const columns of [10, 16]) {
        for (let available = 700; available <= 1500; available += 37) {
          const chart = { mode, columns, withAreas: true };
          const size = fitCellSize({ ...chart, available });
          if (size > FULL_CELL) {
            expect(chartWidth({ ...chart, size })).toBeLessThanOrEqual(available);
          }
        }
      }
    }
  });

  it('gives the primary chart’s ten columns a larger cell in the same space', () => {
    const available = chartWidth({ ...permanent, size: 13 });
    expect(fitCellSize({ ...permanent, columns: 10, available })).toBe(EXPANDED_MAX_CELL);
  });
});
