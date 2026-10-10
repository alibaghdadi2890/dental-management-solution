import { z } from 'zod';

/**
 * Chart marks (feature 9, ADR-0042): the colour and icon a catalog item shows on the dental
 * chart. They live on the catalog item, never on a record, so a change in the Catalog recolours
 * every chart. A colour is one of sixteen palette keys, never a hex value; the theme defines what
 * each key looks like.
 */
export const MARK_COLORS = [
  'rose',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
  'sky',
  'blue',
  'violet',
  'purple',
  'magenta',
  'pink',
  'brown',
] as const;
export const markColorSchema = z.enum(MARK_COLORS);
export type MarkColor = z.infer<typeof markColorSchema>;

/** Services only: what kind of work the mark stands for. */
export const MARK_ICONS = [
  'filling',
  'crown',
  'root_canal',
  'extraction',
  'implant',
  'bridge',
  'veneer',
  'sealant',
  'post_core',
  'denture',
  'cleaning',
  'whitening',
] as const;
export const markIconSchema = z.enum(MARK_ICONS);
export type MarkIcon = z.infer<typeof markIconSchema>;

/** Which marks show first when a tooth has more than fit: higher first, 0–9. */
export const MARK_PRIORITY_MIN = 0;
export const MARK_PRIORITY_MAX = 9;
export const MARK_PRIORITY_DEFAULT = 5;
export const markPrioritySchema = z.number().int().min(MARK_PRIORITY_MIN).max(MARK_PRIORITY_MAX);

/**
 * The theme tokens of a palette key, as CSS values: `fill` (done today), `tint` (done before),
 * `strong` (edges, rings, text) and `on` (an icon drawn on the fill). Pure.
 */
export function markColorVars(color: MarkColor): {
  fill: string;
  tint: string;
  strong: string;
  on: string;
} {
  const token = `--color-mark-${color}`;
  return {
    fill: `var(${token})`,
    tint: `var(${token}-tint)`,
    strong: `var(${token}-strong)`,
    on: `var(${token}-on)`,
  };
}

/**
 * The palette key a new catalog item gets: the one the catalog uses least, the first of them in
 * palette order. `used` holds the colour of every item of that catalog (null = none). Pure.
 */
export function leastUsedMarkColor(used: readonly (MarkColor | null)[]): MarkColor {
  const counts = new Map<MarkColor, number>(MARK_COLORS.map((color) => [color, 0]));
  for (const color of used) {
    if (color !== null) counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  let least: MarkColor = MARK_COLORS[0];
  for (const color of MARK_COLORS) {
    if ((counts.get(color) ?? 0) < (counts.get(least) ?? 0)) least = color;
  }
  return least;
}

/**
 * What the chart needs of a catalog item to draw a record that points at it: its mark, and its
 * current name and code. Inactive and deleted items have one too, so old records still render.
 */
export const catalogMarkSchema = z.object({
  color: markColorSchema.nullable(),
  icon: markIconSchema.nullable(),
  priority: markPrioritySchema,
  name: z.string(),
  code: z.string(),
  active: z.boolean(),
});
export type CatalogMark = z.infer<typeof catalogMarkSchema>;
