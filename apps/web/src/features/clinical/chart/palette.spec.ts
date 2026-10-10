import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MARK_COLORS, type MarkColor } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';

/**
 * The chart-mark palette (feature 9, spec D2–D4), read from the theme itself: what must hold for
 * a tooth to be read at a glance. Colour distance is plain RGB distance and contrast is the WCAG
 * ratio; both are coarse, and enough to catch a key drifting into its neighbour or into a ring.
 */
// Vitest runs from the web app's root.
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`).exec(css);
  if (!match?.[1]) throw new Error(`no theme token --${name}`);
  return match[1];
}

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) as Rgb;
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function distance(a: string, b: string): number {
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

const variants = (color: MarkColor) => ({
  fill: token(`color-mark-${color}`),
  tint: token(`color-mark-${color}-tint`),
  strong: token(`color-mark-${color}-strong`),
  on: token(`color-mark-${color}-on`),
});

const SURFACE = token('color-surface');
/** The rings a fill sits inside: planned, in progress, selected (and the focus ring, which is
 * the selected one). */
const RINGS = {
  planned: token('color-planned-border'),
  inProgress: token('color-warning-dot'),
  selected: token('primary'),
};

const pairs = MARK_COLORS.flatMap((a, index) =>
  MARK_COLORS.slice(index + 1).map((b) => [a, b] as const),
);

describe('the chart-mark palette', () => {
  it.each(MARK_COLORS)(
    '%s: an icon reads on the fill, and the strong variant on the tint',
    (color) => {
      const { fill, tint, strong, on } = variants(color);
      expect(contrast(on, fill)).toBeGreaterThanOrEqual(3);
      expect(contrast(strong, tint)).toBeGreaterThanOrEqual(3);
      // Edges and text on the card.
      expect(contrast(strong, SURFACE)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(MARK_COLORS)('%s: both fills stand off the surface and every ring', (color) => {
    const { fill, tint } = variants(color);
    expect(distance(fill, SURFACE)).toBeGreaterThanOrEqual(100);
    expect(distance(tint, SURFACE)).toBeGreaterThanOrEqual(50);
    for (const ring of Object.values(RINGS)) {
      expect(distance(fill, ring)).toBeGreaterThanOrEqual(40);
      expect(distance(tint, ring)).toBeGreaterThanOrEqual(40);
    }
  });

  it.each(pairs)('%s and %s can be told apart, today and past', (a, b) => {
    expect(distance(variants(a).fill, variants(b).fill)).toBeGreaterThanOrEqual(45);
    expect(distance(variants(a).tint, variants(b).tint)).toBeGreaterThanOrEqual(30);
  });

  it.each(MARK_COLORS)('%s: today is told from past without the edge', (color) => {
    const { fill, tint } = variants(color);
    expect(distance(fill, tint)).toBeGreaterThanOrEqual(60);
  });
});
