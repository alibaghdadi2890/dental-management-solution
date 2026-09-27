import { describe, expect, it } from 'vitest';
import { pageRange, pageWindow } from './pager';

describe('pageWindow', () => {
  it('is just [1] for a single page', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
  });

  it('collapses a large gap on both sides', () => {
    expect(pageWindow(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10]);
  });

  it('fills a run of one instead of showing a lone gap', () => {
    // current=2 leaves only page 4 between {1,2,3} and {10}; a gap that saves one button isn't
    // worth an ellipsis, so 4 is not filled — only a run of one *between two known pages* is.
    expect(pageWindow(2, 10)).toEqual([1, 2, 3, 'gap', 10]);
  });

  it('has no left gap once current is near the start', () => {
    expect(pageWindow(9, 10)).toEqual([1, 'gap', 8, 9, 10]);
  });

  it('fills a single missing page between two runs', () => {
    // current=5, last=8: {1} .. gap .. {4,5,6} .. {8}; 6 and 8 are two apart, so 7 is filled in.
    expect(pageWindow(5, 8)).toEqual([1, 'gap', 4, 5, 6, 7, 8]);
  });

  it('never duplicates a page that is both a boundary and a neighbour', () => {
    expect(pageWindow(2, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(1, 2)).toEqual([1, 2]);
  });

  it('clamps a current page below the first page', () => {
    expect(pageWindow(0, 10)).toEqual(pageWindow(1, 10));
    expect(pageWindow(-5, 10)).toEqual(pageWindow(1, 10));
  });

  it('clamps a current page past the last page', () => {
    expect(pageWindow(999, 10)).toEqual(pageWindow(10, 10));
  });
});

describe('pageRange', () => {
  it('computes the shown range and last page', () => {
    expect(pageRange(2, 10, 54)).toEqual({ page: 2, from: 11, to: 20, total: 54, last: 6 });
  });

  it('clamps the last page to the total', () => {
    expect(pageRange(6, 10, 54)).toEqual({ page: 6, from: 51, to: 54, total: 54, last: 6 });
  });

  it('reports an empty page without dividing by nothing useful', () => {
    expect(pageRange(1, 25, 0)).toEqual({ page: 1, from: 0, to: 0, total: 0, last: 1 });
  });

  it('clamps a stale page past the last page, so from/to reflect the last page instead', () => {
    expect(pageRange(999, 10, 54)).toEqual({ page: 6, from: 51, to: 54, total: 54, last: 6 });
  });

  it('clamps a page below 1', () => {
    expect(pageRange(0, 10, 54)).toEqual({ page: 1, from: 1, to: 10, total: 54, last: 6 });
    expect(pageRange(-3, 10, 54)).toEqual({ page: 1, from: 1, to: 10, total: 54, last: 6 });
  });
});
