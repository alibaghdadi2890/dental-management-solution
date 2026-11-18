import { describe, expect, it } from 'vitest';
import { tableCsv } from '@/components/charts/chart-table';
import { changeTone } from './figure-tone';

describe('changeTone (ADR-0091): good or bad, never up or down', () => {
  it('reads more collected as good and more expenses as bad', () => {
    expect(changeTone(0.25, 'up')).toBe('good');
    expect(changeTone(-0.25, 'up')).toBe('bad');
    expect(changeTone(0.25, 'down')).toBe('bad');
    expect(changeTone(-0.1, 'down')).toBe('good');
  });

  it('is neutral where neither direction is good, and for no change', () => {
    expect(changeTone(0.5, 'neutral')).toBe('neutral');
    expect(changeTone(0, 'up')).toBe('neutral');
  });
});

describe('tableCsv', () => {
  it('writes the exact values, quoting what needs it, with a BOM', () => {
    const csv = tableCsv({
      columns: ['Month', 'Collected'],
      rows: [
        { cells: ['November 2026', '$5,000'], exact: [null, '5000.00'] },
        { cells: ['A, "B"', '—'] },
      ],
    });
    expect(csv).toBe('\uFEFFMonth,Collected\r\nNovember 2026,5000.00\r\n"A, ""B""",—\r\n');
  });
});
