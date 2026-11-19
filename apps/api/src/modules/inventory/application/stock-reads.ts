import {
  fromCents,
  type Movement,
  type StockLabel,
  stockLabels,
  type Unpriced,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { UsersService } from '../../users';
import { valueOf } from '../domain/stock';
import {
  CatalogRepository,
  type StoredItem,
  type StoredItemBranch,
} from '../persistence/catalog.repository';
import {
  type StoredBatch,
  type StoredMovement,
  StockRepository,
} from '../persistence/stock.repository';
import { InventoryCalendar } from './inventory-calendar';
import { valued } from './presenter';

/** One item in one branch, as the labels, the lists and the value read it. */
export interface ItemBranchFacts {
  item: StoredItem;
  branchId: string;
  /** Every batch of the item in the branch, emptied ones too. */
  batches: StoredBatch[];
  state: StoredItemBranch | undefined;
  onHand: number;
  reorderLevel: number | null;
  labels: StockLabel[];
  /** The priced batches' value, in cents. */
  valueCents: bigint;
}

/**
 * The reads every screen of stock shares (B6, C1, E): an item's facts per branch with its labels
 * (computed on the clinic's today), and movements with their cost from the batches they touched,
 * computed when read so a batch priced later costs what it already gave out (D4).
 */
@Injectable()
export class StockReads {
  constructor(
    private readonly context: RequestContext,
    private readonly calendar: InventoryCalendar,
    private readonly catalog: CatalogRepository,
    private readonly stock: StockRepository,
    private readonly users: UsersService,
  ) {}

  withMoney(): boolean {
    return this.context.hasPermission('inventory:money_read');
  }

  /** Every item's facts in a branch, in name order. */
  async branchFacts(branchId: string, only?: readonly string[]): Promise<ItemBranchFacts[]> {
    const [items, batches, states, today, expiringDays] = await Promise.all([
      only ? this.catalog.itemsByIds(only) : this.catalog.items(),
      this.stock.batches({ branchId }),
      this.catalog.itemBranches({ branchId }),
      this.calendar.today(),
      this.calendar.expiringDays(),
    ]);
    const byItem = new Map<string, StoredBatch[]>();
    for (const batch of batches) {
      const own = byItem.get(batch.itemId) ?? [];
      own.push(batch);
      byItem.set(batch.itemId, own);
    }
    const stateOf = new Map(states.map((state) => [state.itemId, state] as const));
    return items
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => {
        const own = byItem.get(item.id) ?? [];
        const state = stateOf.get(item.id);
        return this.facts(item, branchId, own, state, today, expiringDays);
      });
  }

  facts(
    item: StoredItem,
    branchId: string,
    batches: StoredBatch[],
    state: StoredItemBranch | undefined,
    today: string,
    expiringDays: number,
  ): ItemBranchFacts {
    const onHand = batches.reduce((sum, batch) => sum + batch.quantityLeft, 0);
    const reorderLevel = state?.reorderLevel ?? item.reorderLevel;
    const withStock = batches.filter((batch) => batch.quantityLeft > 0);
    const labels = stockLabels(
      {
        active: item.active,
        onHand,
        reorderLevel,
        everStocked: batches.length > 0,
        expiries: [
          ...new Set(
            withStock.flatMap((batch) => (batch.expiresOn === null ? [] : [batch.expiresOn])),
          ),
        ],
        orderedOn: state?.orderedOn ?? null,
        toCount: state?.toCountAt != null,
      },
      today,
      expiringDays,
    );
    let valueCents = 0n;
    for (const batch of withStock) valueCents += valueOf(valued(batch), batch.quantityLeft) ?? 0n;
    return { item, branchId, batches, state, onHand, reorderLevel, labels, valueCents };
  }

  /** Receipts to price and opening batches with no cost, beside every value (E). */
  async unpriced(branchId?: string): Promise<Unpriced> {
    const [receipts, openingBatches] = await Promise.all([
      this.stock.toPriceCount(branchId),
      this.stock.unpricedOpeningBatches(branchId),
    ]);
    return { receipts, openingBatches };
  }

  /**
   * Each movement's cost (signed like its quantity): its batch shares at their batches' unit
   * cost; null when a batch it touched is not priced yet, or without money.
   */
  async costs(rows: readonly StoredMovement[]): Promise<Map<string, bigint | null>> {
    const shares = await this.stock.sharesOf(rows.map((row) => row.id));
    const batches = new Map(
      (await this.stock.batchesByIds([...new Set(shares.map((share) => share.batchId))])).map(
        (batch) => [batch.id, batch] as const,
      ),
    );
    const result = new Map<string, bigint | null>();
    for (const row of rows) result.set(row.id, 0n);
    for (const share of shares) {
      const soFar = result.get(share.movementId);
      const batch = batches.get(share.batchId);
      const value = batch ? valueOf(valued(batch), share.quantity) : null;
      result.set(
        share.movementId,
        soFar === null || soFar === undefined || value === null ? null : soFar + value,
      );
    }
    return result;
  }

  async present(rows: readonly StoredMovement[]): Promise<Movement[]> {
    if (rows.length === 0) return [];
    const money = this.withMoney();
    const [items, receipts, names, costs, today] = await Promise.all([
      this.catalog.itemsByIds([...new Set(rows.map((row) => row.itemId))]),
      this.stock.receiptsByIds([
        ...new Set(rows.flatMap((row) => (row.receiptId ? [row.receiptId] : []))),
      ]),
      this.users.namesByUserIds([...new Set(rows.map((row) => row.createdBy))]),
      money ? this.costs(rows) : Promise.resolve(new Map<string, bigint | null>()),
      this.calendar.today(),
    ]);
    const itemOf = new Map(items.map((item) => [item.id, item] as const));
    const numberOf = new Map(receipts.map((receipt) => [receipt.id, receipt.displayNumber]));
    const me = this.context.userId;
    return rows.map((row) => {
      const item = itemOf.get(row.itemId);
      const cost = costs.get(row.id);
      return {
        id: row.id,
        actionId: row.actionId,
        kind: row.kind,
        itemId: row.itemId,
        itemName: item?.name ?? '',
        unit: item?.unit ?? '',
        packName: item?.packName ?? null,
        packSize: item?.packSize ?? null,
        branchId: row.branchId,
        quantity: row.quantity,
        reason: row.reason,
        note: row.note,
        occurredOn: row.occurredOn,
        createdAt: row.createdAt.toISOString(),
        createdByName: names.get(row.createdBy) ?? null,
        receiptId: row.receiptId,
        receiptNumber: row.receiptId ? (numberOf.get(row.receiptId) ?? null) : null,
        countId: row.countId,
        reversesId: row.reversesId,
        reversedAt: row.reversedAt?.toISOString() ?? null,
        reversalReason: row.reversalReason,
        cost: money && cost !== undefined && cost !== null ? fromCents(cost) : null,
        canUndo:
          row.kind === 'take_out' &&
          row.reversedAt === null &&
          row.createdBy === me &&
          row.occurredOn === today,
      };
    });
  }
}
