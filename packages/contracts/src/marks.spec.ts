import { describe, expect, it } from 'vitest';
import {
  leastUsedMarkColor,
  MARK_COLORS,
  MARK_ICONS,
  markColorVars,
  markPrioritySchema,
} from './marks.js';

describe('the palette', () => {
  it('has sixteen colours and twelve icons, each once', () => {
    expect(new Set(MARK_COLORS).size).toBe(16);
    expect(new Set(MARK_ICONS).size).toBe(12);
  });

  it('names the theme tokens of a key', () => {
    expect(markColorVars('rose')).toEqual({
      fill: 'var(--color-mark-rose)',
      tint: 'var(--color-mark-rose-tint)',
      strong: 'var(--color-mark-rose-strong)',
      on: 'var(--color-mark-rose-on)',
    });
  });
});

describe('leastUsedMarkColor', () => {
  it('is the first key for an empty catalog', () => {
    expect(leastUsedMarkColor([])).toBe('rose');
  });

  it('skips the keys in use, in palette order', () => {
    expect(leastUsedMarkColor(['rose', 'red', null, 'amber'])).toBe('orange');
  });

  it('takes the least used key once every one is in use', () => {
    const twice = MARK_COLORS.filter((color) => color !== 'teal');
    expect(leastUsedMarkColor([...MARK_COLORS, ...twice])).toBe('teal');
  });
});

describe('markPrioritySchema', () => {
  it.each([0, 5, 9])('accepts %i', (priority) => {
    expect(markPrioritySchema.safeParse(priority).success).toBe(true);
  });

  it.each([-1, 10, 2.5])('rejects %d', (priority) => {
    expect(markPrioritySchema.safeParse(priority).success).toBe(false);
  });
});
