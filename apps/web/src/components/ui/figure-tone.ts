/** Which way a change is good: more collected is good, more expenses bad, discounts neither. */
export type GoodWhen = 'up' | 'down' | 'neutral';

/** The chip's tone for a change (ADR-0091): good or bad, never up or down; neutral grey else. */
export function changeTone(change: number, goodWhen: GoodWhen): 'good' | 'bad' | 'neutral' {
  if (goodWhen === 'neutral' || change === 0) return 'neutral';
  return change > 0 === (goodWhen === 'up') ? 'good' : 'bad';
}
