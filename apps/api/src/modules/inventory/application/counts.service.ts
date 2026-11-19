import {
  type Count,
  type CountList,
  type CountSummary,
  fromCents,
  lineAmount,
  type SaveCountLine,
  type StartCount,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { isUniqueViolation } from '../../../platform/db/unique-violation';
import { AuditService } from '../../audit';
import { UsersService } from '../../users';
import {
  CountClosedError,
  CountOpenError,
  InventoryIdempotencyMismatchError,
  InventoryNotFoundError,
} from '../domain/inventory-errors';
import { planCount, valueOf } from '../domain/stock';
import { CatalogRepository, type StoredItem } from '../persistence/catalog.repository';
import {
  MoneyRepository,
  type StoredCount,
  type StoredCountLine,
} from '../persistence/money.repository';
import { type StoredBatch, StockRepository } from '../persistence/stock.repository';
import { InventoryCalendar } from './inventory-calendar';
import { MovementWriter } from './movement-writer';
import { valued } from './presenter';
import { StockReads } from './stock-reads';

/**
 * Stock counts (feature 20a, B5; docs/modules/inventory.md), with `inventory:manage`. One open
 * count per branch. Each line stamps what the system had when it was counted, so work goes on
 * meanwhile and Apply turns `counted − system then` into a `count` movement on the stock as it is
 * (ADR-0099). An item that never had stock in the branch gets its opening stock (B8).
 */
@Injectable()
export class CountsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly calendar: InventoryCalendar,
    private readonly catalog: CatalogRepository,
    private readonly stock: StockRepository,
    private readonly money: MoneyRepository,
    private readonly writer: MovementWriter,
    private readonly users: UsersService,
    private readonly stockReads: StockReads,
  ) {}

  start(input: StartCount): Promise<Count> {
    this.context.requirePermission('inventory:manage');
    return this.tenantDb.run(async () => {
      await this.calendar.assertBranch(input.branchId);
      if (await this.money.openCount(input.branchId)) {
        throw new CountOpenError('This branch already has an open count');
      }
      const scope = new Set(input.categoryIds);
      const items = (await this.catalog.items()).filter(
        (item) => item.active && (scope.size === 0 || scope.has(item.categoryId)),
      );
      const count = await this.money
        .insertCount({
          branchId: input.branchId,
          categoryIds: [...scope],
          startedBy: this.context.requireUserId(),
        })
        .catch((error: unknown) => {
          throw isUniqueViolation(error)
            ? new CountOpenError('This branch already has an open count')
            : error;
        });
      await this.money.insertCountLines(
        count.id,
        items.map((item) => item.id),
      );
      await this.audit.record({
        action: 'inventory_count.start',
        resourceType: 'inventory_count',
        resourceId: count.id,
        after: { branchId: input.branchId, categoryIds: [...scope], items: items.length },
      });
      return this.read(count.id);
    });
  }

  list(branchId: string): Promise<CountList> {
    this.context.requirePermission('inventory:read');
    return this.tenantDb.run(async () => {
      const counts = await this.money.counts(branchId);
      const lines = await this.money.countLines(counts.map((count) => count.id));
      const names = await this.names(counts);
      const values = this.reads() ? await this.lineValues(counts, lines, branchId) : null;
      return {
        items: counts.map((count) =>
          this.summary(
            count,
            lines.filter((line) => line.countId === count.id),
            names,
            values,
          ),
        ),
      };
    });
  }

  get(id: string): Promise<Count> {
    this.context.requirePermission('inventory:read');
    return this.tenantDb.run(() => this.read(id));
  }

  /** Saves one line as the user goes: what was counted, and what the system had then. */
  saveLine(countId: string, itemId: string, input: SaveCountLine): Promise<Count> {
    this.context.requirePermission('inventory:manage');
    if (input.opening?.price) this.context.requirePermission('inventory:money_manage');
    return this.tenantDb.run(async () => {
      const count = await this.requireOpen(countId);
      const line = await this.money.lockCountLine(countId, itemId);
      if (!line) throw new InventoryNotFoundError('This item is not in the count', { itemId });
      // Whoever may not price leaves the cost someone else typed as it is.
      const canPrice = this.context.hasPermission('inventory:money_manage');
      const batches = await this.stock.lockBatches(itemId, count.branchId);
      const onHand = batches.reduce((sum, batch) => sum + batch.quantityLeft, 0);
      const opening = batches.length === 0 ? input.opening : null;
      await this.money.updateCountLine(line.id, {
        counted: input.counted,
        systemThen: input.counted === null ? null : onHand,
        countedBy: input.counted === null ? null : this.context.requireUserId(),
        countedAt: input.counted === null ? null : this.calendar.now(),
        openingPrice: canPrice ? (opening?.price ?? null) : line.openingPrice,
        openingPricePer: canPrice
          ? opening?.price
            ? opening.pricePer
            : null
          : line.openingPricePer,
        openingLot: opening?.lot ?? null,
        openingExpiresOn: opening?.expiresOn ?? null,
      });
      return this.read(countId);
    });
  }

  /**
   * Turns every counted line into an adjustment with the reason _Count_, in one step (D6); lines
   * left empty change nothing. A retry with the same key returns the applied count.
   */
  apply(countId: string, key: string): Promise<Count> {
    this.context.requirePermission('inventory:manage');
    return this.tenantDb.run(async () => {
      await this.catalog.lockKey('count', key);
      const count = await this.money.count(countId, true);
      if (!count) throw new InventoryNotFoundError('No such count', { countId });
      if (count.status === 'applied' && count.applyIdempotencyKey === key) {
        return this.read(countId);
      }
      if (count.status !== 'open') {
        if (count.applyIdempotencyKey !== null && count.applyIdempotencyKey !== key) {
          throw new InventoryIdempotencyMismatchError('This count was applied by another request');
        }
        throw new CountClosedError('This count is closed');
      }
      const lines = (await this.money.countLines([countId])).filter(
        (line) => line.counted !== null,
      );
      const items = new Map(
        (await this.catalog.lockItems(lines.map((line) => line.itemId))).map(
          (item) => [item.id, item] as const,
        ),
      );
      const today = await this.calendar.today();
      const currency = await this.calendar.currency();
      const applied: { item: string; difference: number }[] = [];
      for (const line of [...lines].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
        const item = items.get(line.itemId) as StoredItem;
        const batches = await this.liveBatches(
          await this.stock.lockBatches(line.itemId, count.branchId),
        );
        const plan = planCount(
          line.counted as number,
          line.systemThen as number,
          batches.map((batch) => ({
            id: batch.id,
            expiresOn: batch.expiresOn,
            receivedOn: batch.receivedOn,
            left: batch.quantityLeft,
          })),
        );
        let difference = 0;
        if (plan.kind === 'opening') {
          const batch = await this.stock.insertBatch({
            itemId: item.id,
            branchId: count.branchId,
            source: 'opening',
            receiptId: null,
            position: null,
            lot: line.openingLot,
            expiresOn: line.openingExpiresOn,
            receivedOn: today,
            quantity: plan.quantity,
            quantityLeft: 0,
            ...this.openingPrice(line, plan.quantity, item),
            currency,
          });
          await this.writer.write({
            actionId: countId,
            kind: 'opening',
            itemId: item.id,
            branchId: count.branchId,
            shares: [{ batchId: batch.id, quantity: plan.quantity }],
            countId,
          });
          difference = plan.quantity;
        } else if (plan.kind === 'change') {
          await this.writer.write({
            actionId: countId,
            kind: 'count',
            itemId: item.id,
            branchId: count.branchId,
            shares: plan.shares,
            reason: 'count',
            countId,
          });
          difference = plan.quantity;
        }
        await this.money.updateCountLine(line.id, { difference });
        if (difference !== 0) applied.push({ item: item.name, difference });
      }
      await this.catalog.clearToCount(
        lines.map((line) => line.itemId),
        count.branchId,
      );
      await this.money.closeCount(
        countId,
        'applied',
        this.calendar.now(),
        this.context.requireUserId(),
        key,
      );
      await this.audit.record({
        action: 'inventory_count.apply',
        resourceType: 'inventory_count',
        resourceId: countId,
        before: { status: 'open' },
        after: { status: 'applied', branchId: count.branchId, counted: lines.length, applied },
      });
      return this.read(countId);
    });
  }

  discard(countId: string): Promise<Count> {
    this.context.requirePermission('inventory:manage');
    return this.tenantDb.run(async () => {
      const count = await this.requireOpen(countId);
      await this.money.closeCount(
        countId,
        'discarded',
        this.calendar.now(),
        this.context.requireUserId(),
        null,
      );
      await this.audit.record({
        action: 'inventory_count.discard',
        resourceType: 'inventory_count',
        resourceId: countId,
        before: { status: 'open' },
        after: { status: 'discarded', branchId: count.branchId },
      });
      return this.read(countId);
    });
  }

  // --- Helpers ---

  /** The batches stock may join or leave: not those of a voided receipt. */
  private async liveBatches(batches: readonly StoredBatch[]): Promise<StoredBatch[]> {
    const receiptIds = [...new Set(batches.flatMap((batch) => batch.receiptId ?? []))];
    const voided = new Set(
      (await this.stock.receiptsByIds(receiptIds))
        .filter((receipt) => receipt.voidedAt !== null)
        .map((receipt) => receipt.id),
    );
    return batches.filter((batch) => batch.receiptId === null || !voided.has(batch.receiptId));
  }

  private reads(): boolean {
    return this.context.hasPermission('inventory:money_read');
  }

  private openingPrice(line: StoredCountLine, quantity: number, item: StoredItem) {
    if (line.openingPrice === null) return { price: null, pricePer: null, amount: null };
    const pricePer = item.packSize === null ? 'unit' : (line.openingPricePer ?? 'unit');
    return {
      price: line.openingPrice,
      pricePer,
      amount: lineAmount(line.openingPrice, pricePer, quantity, item.packSize),
    } as const;
  }

  private async read(id: string): Promise<Count> {
    const count = await this.money.count(id);
    if (!count) throw new InventoryNotFoundError('No such count', { countId: id });
    const lines = await this.money.countLines([id]);
    const [items, batches, names] = await Promise.all([
      this.catalog.itemsByIds(lines.map((line) => line.itemId)),
      this.stock.batches({ branchId: count.branchId }),
      this.names([count], lines),
    ]);
    const itemOf = new Map(items.map((item) => [item.id, item] as const));
    const batchesOf = new Map<string, StoredBatch[]>();
    for (const batch of batches) {
      batchesOf.set(batch.itemId, [...(batchesOf.get(batch.itemId) ?? []), batch]);
    }
    const values = this.reads()
      ? await this.lineValues([count], lines, count.branchId, batches)
      : null;
    return {
      ...this.summary(count, lines, names, values),
      currency: await this.calendar.currency(),
      lines: lines
        .map((line) => {
          const item = itemOf.get(line.itemId) as StoredItem;
          const own = batchesOf.get(line.itemId) ?? [];
          const difference =
            line.difference ??
            (line.counted !== null && line.systemThen !== null
              ? line.counted - line.systemThen
              : null);
          const value = values?.get(line.id);
          return {
            itemId: item.id,
            name: item.name,
            code: item.code,
            categoryId: item.categoryId,
            unit: item.unit,
            packName: item.packName,
            packSize: item.packSize,
            tracksExpiry: item.tracksExpiry,
            onHand:
              count.status === 'open'
                ? own.reduce((sum, batch) => sum + batch.quantityLeft, 0)
                : (line.systemThen ?? 0),
            counted: line.counted,
            systemThen: line.systemThen,
            difference,
            value: value === undefined || value === null ? null : fromCents(value),
            opening: line.difference === null ? own.length === 0 : false,
            openingDetails:
              line.openingPrice !== null || line.openingLot !== null || line.openingExpiresOn
                ? {
                    price: this.reads() ? line.openingPrice : null,
                    pricePer: line.openingPricePer ?? 'unit',
                    lot: line.openingLot,
                    expiresOn: line.openingExpiresOn,
                  }
                : null,
            countedByName: line.countedBy ? (names.get(line.countedBy) ?? null) : null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /**
   * What each line's difference is worth (B5): once applied, the cost of the movement it made;
   * while open, a shortage at the batches it would leave, a surplus at the newest batch's cost.
   */
  private async lineValues(
    counts: readonly StoredCount[],
    lines: readonly StoredCountLine[],
    branchId: string,
    known?: readonly StoredBatch[],
  ): Promise<Map<string, bigint | null>> {
    const result = new Map<string, bigint | null>();
    const applied = counts.filter((count) => count.status === 'applied').map((count) => count.id);
    if (applied.length > 0) {
      const movements = await this.stock.movements({ countIds: applied });
      const costs = await this.stockReads.costs(movements);
      const byLine = new Map(
        movements.map((movement) => [`${movement.countId ?? ''}:${movement.itemId}`, movement.id]),
      );
      for (const line of lines) {
        const movementId = byLine.get(`${line.countId}:${line.itemId}`);
        if (movementId !== undefined) result.set(line.id, costs.get(movementId) ?? null);
      }
    }
    const open = new Set(
      counts.filter((count) => count.status === 'open').map((count) => count.id),
    );
    if (open.size === 0) return result;
    const batches = await this.liveBatches(known ?? (await this.stock.batches({ branchId })));
    for (const line of lines) {
      if (!open.has(line.countId) || line.counted === null || line.systemThen === null) continue;
      const own = batches.filter((batch) => batch.itemId === line.itemId);
      const plan = planCount(
        line.counted,
        line.systemThen,
        own.map((batch) => ({
          id: batch.id,
          expiresOn: batch.expiresOn,
          receivedOn: batch.receivedOn,
          left: batch.quantityLeft,
        })),
      );
      if (plan.kind !== 'change') continue;
      let cents: bigint | null = 0n;
      for (const share of plan.shares) {
        const batch = own.find((candidate) => candidate.id === share.batchId) as StoredBatch;
        const value = valueOf(valued(batch), share.quantity);
        cents = cents === null || value === null ? null : cents + value;
      }
      result.set(line.id, cents);
    }
    return result;
  }

  private summary(
    count: StoredCount,
    lines: readonly StoredCountLine[],
    names: ReadonlyMap<string, string>,
    values: ReadonlyMap<string, bigint | null> | null,
  ): CountSummary {
    const counted = lines.filter((line) => line.counted !== null);
    const differing = counted.filter((line) =>
      line.difference !== null
        ? line.difference !== 0
        : (line.counted as number) !== (line.systemThen as number),
    );
    let differenceValue: bigint | null = values === null ? null : 0n;
    if (values !== null) {
      for (const line of differing) {
        const value = values.get(line.id);
        if (value === null) {
          differenceValue = null;
          break;
        }
        differenceValue = (differenceValue ?? 0n) + (value ?? 0n);
      }
    }
    return {
      id: count.id,
      branchId: count.branchId,
      categoryIds: count.categoryIds,
      status: count.status,
      startedAt: count.createdAt.toISOString(),
      startedByName: names.get(count.startedBy) ?? null,
      closedAt: count.closedAt?.toISOString() ?? null,
      closedByName: count.closedBy ? (names.get(count.closedBy) ?? null) : null,
      lineCount: lines.length,
      countedCount: counted.length,
      differenceCount: differing.length,
      differenceValue: differenceValue === null ? null : fromCents(differenceValue),
    };
  }

  private names(
    counts: readonly StoredCount[],
    lines: readonly StoredCountLine[] = [],
  ): Promise<Map<string, string>> {
    return this.users.namesByUserIds([
      ...new Set([
        ...counts.flatMap((count) => [
          count.startedBy,
          ...(count.closedBy ? [count.closedBy] : []),
        ]),
        ...lines.flatMap((line) => (line.countedBy ? [line.countedBy] : [])),
      ]),
    ]);
  }

  private async requireOpen(id: string): Promise<StoredCount> {
    const count = await this.money.count(id, true);
    if (!count) throw new InventoryNotFoundError('No such count', { countId: id });
    if (count.status !== 'open') throw new CountClosedError('This count is closed');
    return count;
  }
}
