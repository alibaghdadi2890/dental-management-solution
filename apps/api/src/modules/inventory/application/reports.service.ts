import {
  type FinancialStock,
  fromCents,
  type InventoryReport,
  type InventoryReportQuery,
  type MovementReason,
  STOCK_CARD_TOP,
  toCents,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { valueOf } from '../domain/stock';
import { CatalogRepository } from '../persistence/catalog.repository';
import { type StoredMovement, StockRepository } from '../persistence/stock.repository';
import { InventoryCalendar } from './inventory-calendar';
import { totalOf, valued } from './presenter';
import { StockReads } from './stock-reads';

interface Consumed {
  itemId: string;
  quantity: number;
  cents: bigint;
  unpriced: boolean;
}

/**
 * What stock is worth and where it went (feature 20a, Part E): consumption (take-outs net of
 * their reversals), adjustments by reason, purchases by supplier, stock value by category. Costs
 * are the batches' (D4), computed when read. `inventory:read`; every amount `inventory:money_read`.
 */
@Injectable()
export class InventoryReportsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly calendar: InventoryCalendar,
    private readonly catalog: CatalogRepository,
    private readonly stock: StockRepository,
    private readonly reads: StockReads,
  ) {}

  report(query: InventoryReportQuery): Promise<InventoryReport> {
    this.context.requirePermission('inventory:read');
    return this.tenantDb.run(async () => {
      const money = this.reads.withMoney();
      const items = new Map((await this.catalog.items()).map((item) => [item.id, item] as const));
      const consumed = await this.consumption(query);
      const categories = new Map<string, { quantity: number; cents: bigint }>();
      for (const row of consumed) {
        const categoryId = items.get(row.itemId)?.categoryId as string;
        const total = categories.get(categoryId) ?? { quantity: 0, cents: 0n };
        categories.set(categoryId, {
          quantity: total.quantity + row.quantity,
          cents: total.cents + row.cents,
        });
      }
      const adjustments = await this.adjustments(query);
      return {
        currency: await this.calendar.currency(),
        consumption: {
          items: consumed.map((row) => {
            const item = items.get(row.itemId);
            return {
              itemId: row.itemId,
              name: item?.name ?? '',
              categoryId: item?.categoryId as string,
              unit: item?.unit ?? '',
              packName: item?.packName ?? null,
              packSize: item?.packSize ?? null,
              quantity: row.quantity,
              cost: money ? fromCents(row.cents) : null,
              unpriced: row.unpriced,
            };
          }),
          categories: [...categories.entries()].map(([categoryId, total]) => ({
            categoryId,
            quantity: total.quantity,
            cost: money ? fromCents(total.cents) : null,
          })),
          total: money ? fromCents(consumed.reduce((sum, row) => sum + row.cents, 0n)) : null,
        },
        adjustments: adjustments.map((row) => ({
          reason: row.reason,
          quantity: row.quantity,
          cost: money ? fromCents(row.cents) : null,
        })),
        purchases: money ? await this.purchases(query) : null,
        value: money ? await this.value(query.branchId) : null,
        unpriced: await this.reads.unpriced(query.branchId),
      };
    });
  }

  /** The dashboard's Stock card (C4): value now, consumption in the period, the top items. */
  stockCard(query: InventoryReportQuery): Promise<FinancialStock> {
    this.context.requirePermission('inventory:money_read');
    return this.tenantDb.run(async () => {
      const consumed = (await this.consumption(query)).sort((a, b) =>
        b.cents === a.cents ? 0 : b.cents > a.cents ? 1 : -1,
      );
      const top = consumed.filter((row) => row.cents > 0n).slice(0, STOCK_CARD_TOP);
      const names = new Map(
        (await this.catalog.itemsByIds(top.map((row) => row.itemId))).map(
          (item) => [item.id, item.name] as const,
        ),
      );
      const total = consumed.reduce((sum, row) => sum + row.cents, 0n);
      const shown = top.reduce((sum, row) => sum + row.cents, 0n);
      return {
        currency: await this.calendar.currency(),
        value: (await this.value(query.branchId)).total,
        consumption: fromCents(total),
        top: top.map((row) => ({
          itemId: row.itemId,
          name: names.get(row.itemId) ?? '',
          cost: fromCents(row.cents),
        })),
        other: fromCents(total - shown),
        unpriced: await this.reads.unpriced(query.branchId),
      };
    });
  }

  /** Take-outs net of their reversals, by item, in the period (by the day each happened). */
  private async consumption(query: InventoryReportQuery): Promise<Consumed[]> {
    const rows = await this.stock.movements({
      kinds: ['take_out', 'reversal'],
      branchId: query.branchId,
      from: query.from,
      to: query.to,
    });
    const costs = await this.reads.costs(rows);
    return this.byKey(rows, costs, (row) => row.itemId).map(([itemId, total]) => ({
      itemId,
      quantity: -total.quantity,
      cents: -total.cents,
      unpriced: total.unpriced,
    }));
  }

  private async adjustments(
    query: InventoryReportQuery,
  ): Promise<{ reason: MovementReason; quantity: number; cents: bigint }[]> {
    const rows = await this.stock.movements({
      kinds: ['adjust', 'count'],
      branchId: query.branchId,
      from: query.from,
      to: query.to,
    });
    const costs = await this.reads.costs(rows);
    return this.byKey(rows, costs, (row) => row.reason ?? 'count').map(([reason, total]) => ({
      reason: reason as MovementReason,
      quantity: total.quantity,
      cents: total.cents,
    }));
  }

  private byKey(
    rows: readonly StoredMovement[],
    costs: ReadonlyMap<string, bigint | null>,
    keyOf: (row: StoredMovement) => string,
  ): [string, { quantity: number; cents: bigint; unpriced: boolean }][] {
    const totals = new Map<string, { quantity: number; cents: bigint; unpriced: boolean }>();
    for (const row of rows) {
      const key = keyOf(row);
      const total = totals.get(key) ?? { quantity: 0, cents: 0n, unpriced: false };
      const cost = costs.get(row.id) ?? null;
      totals.set(key, {
        quantity: total.quantity + row.quantity,
        cents: total.cents + (cost ?? 0n),
        unpriced: total.unpriced || cost === null,
      });
    }
    return [...totals.entries()].filter(([, total]) => total.quantity !== 0 || total.cents !== 0n);
  }

  private async purchases(query: InventoryReportQuery): Promise<InventoryReport['purchases']> {
    const receipts = await this.stock.receiptsBetween(query.from, query.to, query.branchId);
    const batches = await this.stock.batchesOfReceipts(receipts.map((receipt) => receipt.id));
    const suppliers = new Map(
      (
        await this.catalog.suppliersByIds([
          ...new Set(receipts.flatMap((receipt) => receipt.supplierId ?? [])),
        ])
      ).map((row) => [row.id, row.name] as const),
    );
    const groups = new Map<
      string,
      { supplierId: string | null; name: string; receipts: number; cents: bigint }
    >();
    for (const receipt of receipts) {
      const totals = totalOf(
        receipt,
        batches.filter((batch) => batch.receiptId === receipt.id),
      );
      if (totals === null) continue;
      const key = receipt.supplierId ?? `payee:${(receipt.payee ?? '').toLocaleLowerCase()}`;
      const group = groups.get(key) ?? {
        supplierId: receipt.supplierId,
        name: receipt.supplierId
          ? (suppliers.get(receipt.supplierId) ?? '')
          : (receipt.payee ?? ''),
        receipts: 0,
        cents: 0n,
      };
      group.receipts += 1;
      group.cents += toCents(totals.total);
      groups.set(key, group);
    }
    return [...groups.values()]
      .sort((a, b) => (b.cents === a.cents ? 0 : b.cents > a.cents ? 1 : -1))
      .map((group) => ({
        supplierId: group.supplierId,
        name: group.name,
        receipts: group.receipts,
        total: fromCents(group.cents),
      }));
  }

  /** Stock value now, by category (E): priced batches with stock left. */
  private async value(
    branchId: string | undefined,
  ): Promise<NonNullable<InventoryReport['value']>> {
    const batches = await this.stock.batches({
      ...(branchId ? { branchId } : {}),
      withStock: true,
    });
    const items = new Map((await this.catalog.items()).map((item) => [item.id, item] as const));
    const byCategory = new Map<string, bigint>();
    let total = 0n;
    for (const batch of batches) {
      const value = valueOf(valued(batch), batch.quantityLeft);
      if (value === null) continue;
      const categoryId = items.get(batch.itemId)?.categoryId as string;
      byCategory.set(categoryId, (byCategory.get(categoryId) ?? 0n) + value);
      total += value;
    }
    return {
      total: fromCents(total),
      categories: [...byCategory.entries()].map(([categoryId, cents]) => ({
        categoryId,
        value: fromCents(cents),
      })),
    };
  }
}
