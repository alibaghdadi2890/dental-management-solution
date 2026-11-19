import { idSchema, isoDateSchema, STOCK_LABEL_KINDS } from '@dcm/contracts';
import { z } from 'zod';

export const INVENTORY_TABS = ['stock', 'receipts', 'counts', 'suppliers', 'reports'] as const;
export type InventoryTab = (typeof INVENTORY_TABS)[number];

/** What the Stock tab shows instead of the list: the Catalog-style editor or the reorder list. */
export const STOCK_VIEWS = ['edit', 'reorder'] as const;

const optional = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const searchSchema = z.object({
  tab: optional(z.enum(INVENTORY_TABS)),
  branch: optional(idSchema),
  q: optional(z.string().max(100)),
  category: optional(idSchema),
  status: optional(z.enum(STOCK_LABEL_KINDS)),
  supplier: optional(idSchema),
  inactive: optional(z.literal(true)),
  item: optional(idSchema),
  view: optional(z.enum(STOCK_VIEWS)),
  toPrice: optional(z.literal(true)),
  from: optional(isoDateSchema),
  to: optional(isoDateSchema),
});

/** The Inventory screen's URL (C1): the tab, the branch, the filters and the open item. */
export type InventorySearch = z.infer<typeof searchSchema>;

export function parseInventorySearch(search: Record<string, unknown>): InventorySearch {
  const parsed = searchSchema.parse(search);
  const period =
    parsed.from && parsed.to && parsed.from <= parsed.to ? {} : { from: undefined, to: undefined };
  // Undefined keys stay out of the URL.
  return Object.fromEntries(
    Object.entries({ ...parsed, ...period }).filter(([, value]) => value !== undefined),
  );
}
