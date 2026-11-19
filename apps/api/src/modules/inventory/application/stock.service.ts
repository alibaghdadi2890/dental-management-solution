import {
  type AdjustStock,
  type ExportLanguage,
  fromCents,
  type ItemDetail,
  lineAmount,
  type Movement,
  type MovementListQuery,
  type MovementPage,
  type PriceBatch,
  type ReorderList,
  type StockList,
  type StockQuery,
  type StockToday,
  type TakeOut,
  type TakeOutResult,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { csvRow, UTF8_BOM } from '../../../platform/kernel/csv';
import { newId } from '../../../platform/kernel/id';
import { requestHash } from '../../../platform/kernel/request-hash';
import { AuditService } from '../../audit';
import { TenancyService } from '../../tenancy';
import {
  ExpiredBatchError,
  ExpiryRequiredError,
  InventoryIdempotencyMismatchError,
  InventoryInactiveError,
  InventoryNotFoundError,
  MovementNotReversibleError,
  NotEnoughStockError,
} from '../domain/inventory-errors';
import { allocate, type BatchShare, onHandOf } from '../domain/stock';
import { CatalogRepository, type StoredItem } from '../persistence/catalog.repository';
import {
  type StoredBatch,
  type StoredMovement,
  StockRepository,
} from '../persistence/stock.repository';
import { INVENTORY_EXPORT_LABELS, unitWord } from './export-labels';
import { InventoryCalendar } from './inventory-calendar';
import { MovementWriter } from './movement-writer';
import { toBatch, toItem } from './presenter';
import type { CsvFile } from './suppliers.service';
import { type ItemBranchFacts, StockReads } from './stock-reads';

/**
 * Stock (feature 20a, Part B; docs/modules/inventory.md): what each branch holds, taking out,
 * undoing and reversing, adjusting, the Today counts, the reorder list. Reads need
 * `inventory:read`; taking out and undoing your own `inventory:write`; adjusting and reversing
 * `inventory:manage`; costs and values `inventory:money_read`. Stock changes only through a
 * movement, written under a lock on the item's batches in the branch (ADR-0095).
 */
@Injectable()
export class StockService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly calendar: InventoryCalendar,
    private readonly tenancy: TenancyService,
    private readonly catalog: CatalogRepository,
    private readonly stock: StockRepository,
    private readonly writer: MovementWriter,
    private readonly reads: StockReads,
  ) {}

  /** The Stock list of a branch (C1): every item with its quantity, labels and value. */
  list(query: StockQuery): Promise<StockList> {
    this.context.requirePermission('inventory:read');
    return this.tenantDb.run(async () => {
      await this.calendar.assertBranch(query.branchId);
      const money = this.reads.withMoney();
      const facts = await this.reads.branchFacts(query.branchId);
      return {
        branchId: query.branchId,
        currency: await this.calendar.currency(),
        today: await this.calendar.today(),
        rows: facts.map((fact) => ({
          itemId: fact.item.id,
          name: fact.item.name,
          code: fact.item.code,
          categoryId: fact.item.categoryId,
          unit: fact.item.unit,
          packName: fact.item.packName,
          packSize: fact.item.packSize,
          tracksExpiry: fact.item.tracksExpiry,
          active: fact.item.active,
          usualSupplierId: fact.item.usualSupplierId,
          onHand: fact.onHand,
          reorderLevel: fact.reorderLevel,
          labels: fact.labels,
          value: money ? fromCents(fact.valueCents) : null,
        })),
        value: money ? fromCents(facts.reduce((sum, fact) => sum + fact.valueCents, 0n)) : null,
        unpriced: money ? await this.reads.unpriced(query.branchId) : null,
      };
    });
  }

  async export(query: StockQuery): Promise<CsvFile> {
    const list = await this.list(query);
    const lang: ExportLanguage = query.lang ?? (await this.tenancy.currentTenant()).locale;
    const labels = INVENTORY_EXPORT_LABELS[lang];
    const categories = new Map(
      (await this.tenantDb.run(() => this.catalog.categories())).map((row) => [
        row.id,
        row.key ? labels.categories[row.key] : (row.name ?? ''),
      ]),
    );
    const money = list.value !== null;
    const header = csvRow([
      labels.stock.name,
      labels.stock.code,
      labels.stock.category,
      labels.stock.unit,
      labels.stock.onHand,
      labels.stock.reorderLevel,
      labels.stock.status,
      ...(money ? [labels.stock.value] : []),
    ]);
    const body = list.rows
      .filter((row) => row.active)
      .map((row) =>
        csvRow(
          [
            row.name,
            row.code ?? '',
            categories.get(row.categoryId) ?? '',
            unitWord(labels, row.unit),
            String(row.onHand),
            row.reorderLevel === null ? '' : String(row.reorderLevel),
            row.labels.map((label) => labels.labels[label.kind]).join(', '),
            ...(money ? [row.value ?? ''] : []),
          ],
          { numericColumns: money ? [4, 5, 7] : [4, 5] },
        ),
      );
    return {
      fileName: `stock-${list.today}.csv`,
      body: UTF8_BOM + header + body.join(''),
    };
  }

  /** The item panel (C1): its settings, its state in each branch, its batches. */
  item(itemId: string): Promise<ItemDetail> {
    this.context.requirePermission('inventory:read');
    return this.tenantDb.run(async () => {
      const [item] = await this.catalog.itemsByIds([itemId]);
      if (!item) throw new InventoryNotFoundError('No such item', { itemId });
      const money = this.reads.withMoney();
      const [batches, states, branchIds, moved, today, expiringDays] = await Promise.all([
        this.stock.batches({ itemId }),
        this.catalog.itemBranches({ itemId }),
        this.calendar.branchIds(),
        this.catalog.movedItemIds([itemId]),
        this.calendar.today(),
        this.calendar.expiringDays(),
      ]);
      const branches = [...new Set([...branchIds, ...batches.map((batch) => batch.branchId)])];
      const receipts = new Map(
        (
          await this.stock.receiptsByIds([
            ...new Set(batches.flatMap((batch) => (batch.receiptId ? [batch.receiptId] : []))),
          ])
        ).map((receipt) => [receipt.id, receipt.displayNumber] as const),
      );
      const withStock = batches.filter((batch) => batch.quantityLeft > 0);
      const emptied = batches.filter((batch) => batch.quantityLeft === 0).slice(-20);
      return {
        item: toItem(item, moved.has(itemId)),
        currency: await this.calendar.currency(),
        branches: branches.map((branchId) => {
          const state = states.find((row) => row.branchId === branchId);
          const fact = this.reads.facts(
            item,
            branchId,
            batches.filter((batch) => batch.branchId === branchId),
            state,
            today,
            expiringDays,
          );
          return {
            branchId,
            onHand: fact.onHand,
            ownReorderLevel: state?.reorderLevel ?? null,
            labels: fact.labels,
            orderedOn: state?.orderedOn ?? null,
            orderedNote: state?.orderedNote ?? null,
            toCount: state?.toCountAt != null,
          };
        }),
        batches: [...withStock, ...emptied.reverse()].map((batch) =>
          toBatch(batch, batch.receiptId ? (receipts.get(batch.receiptId) ?? null) : null, money),
        ),
      };
    });
  }

  /** The movements behind a figure, or an item's history (C1, E), newest first. */
  movements(query: MovementListQuery): Promise<MovementPage> {
    this.context.requirePermission('inventory:read');
    return this.tenantDb.run(async () => {
      const itemIds = query.categoryId
        ? await this.stock.itemIdsOfCategory(query.categoryId)
        : undefined;
      const receiptIds = query.supplierId
        ? (await this.stock.supplierReceipts([query.supplierId])).map((receipt) => receipt.id)
        : undefined;
      const { limit } = query;
      const rows = await this.stock.movements(
        {
          itemId: query.itemId,
          itemIds,
          branchId: query.branchId,
          kinds: query.kinds,
          reason: query.reason,
          from: query.from,
          to: query.to,
          receiptIds,
          before: query.cursor,
        },
        limit + 1,
      );
      const page = rows.slice(0, limit);
      return {
        items: await this.reads.present(page),
        nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
        currency: await this.calendar.currency(),
      };
    });
  }

  /**
   * `POST /inventory/take-outs` (Idempotency-Key, B3): each item leaves the batches that expire
   * first (or the one chosen), under a lock on its batches; more than is on hand is refused and
   * nothing is taken; a batch past its expiry warns unless `allowExpired`.
   */
  takeOut(input: TakeOut, key: string): Promise<TakeOutResult> {
    this.context.requirePermission('inventory:write');
    return this.tenantDb.run(async () => {
      const hash = requestHash({ takeOut: input });
      await this.catalog.lockKey('take-out', key);
      const first = await this.stock.movementsByKey(key);
      if (first.length > 0) {
        if (first[0]?.idempotencyHash !== hash) throw this.mismatch();
        return { movements: await this.reads.present(first) };
      }
      await this.calendar.assertBranch(input.branchId);
      const today = await this.calendar.today();
      const items = await this.requireActive(input.items.map((line) => line.itemId));
      const actionId = newId();
      const written: StoredMovement[] = [];
      // Item id order: two take-outs of the same items lock them in the same order.
      const lines = [...input.items].sort((a, b) => a.itemId.localeCompare(b.itemId));
      for (const line of lines) {
        const batches = await this.stock.lockBatches(line.itemId, input.branchId);
        const shares = this.allocateOrRefuse(line.itemId, batches, line.quantity, line.batchId);
        if (!input.allowExpired) this.warnExpired(line.itemId, batches, shares, today);
        const item = items.get(line.itemId) as StoredItem;
        const movement = await this.writer.write({
          actionId,
          kind: 'take_out',
          itemId: line.itemId,
          branchId: input.branchId,
          shares,
          note: line.note,
          idempotencyKey: key,
          idempotencyHash: hash,
        });
        await this.audit.record({
          action: 'inventory_movement.take_out',
          resourceType: 'inventory_movement',
          resourceId: movement.id,
          after: {
            item: item.name,
            unit: item.unit,
            quantity: line.quantity,
            branchId: input.branchId,
            note: line.note,
          },
        });
        written.push(movement);
      }
      return { movements: await this.reads.present(written) };
    });
  }

  /** Its author's undo, the same clinic day (B3): the units go back to the batches they left. */
  undo(movementId: string): Promise<Movement> {
    this.context.requirePermission('inventory:write');
    return this.tenantDb.run(async () => {
      const movement = await this.requireReversible(movementId);
      if (
        movement.createdBy !== this.context.requireUserId() ||
        movement.occurredOn !== (await this.calendar.today())
      ) {
        throw new MovementNotReversibleError('Only its author may undo it, the same day');
      }
      return this.reverseRow(movement, null, 'undo');
    });
  }

  /** A later reversal with a reason, by someone who manages inventory (B3). */
  reverse(movementId: string, reason: string): Promise<Movement> {
    this.context.requirePermission('inventory:manage');
    return this.tenantDb.run(async () =>
      this.reverseRow(await this.requireReversible(movementId), reason, 'reverse'),
    );
  }

  /**
   * `POST /inventory/adjustments` (Idempotency-Key, B4): one batch, one reason; only a correction
   * adds; never below zero.
   */
  adjust(input: AdjustStock, key: string): Promise<Movement> {
    this.context.requirePermission('inventory:manage');
    return this.tenantDb.run(async () => {
      const hash = requestHash({ adjust: input });
      await this.catalog.lockKey('adjust', key);
      const [first] = await this.stock.movementsByKey(key);
      if (first) {
        if (first.idempotencyHash !== hash) throw this.mismatch();
        return (await this.reads.present([first]))[0] as Movement;
      }
      const [item] = await this.catalog.itemsByIds([input.itemId]);
      if (!item) throw new InventoryNotFoundError('No such item', { itemId: input.itemId });
      const batches = await this.stock.lockBatches(input.itemId, input.branchId);
      const batch = batches.find((candidate) => candidate.id === input.batchId);
      if (!batch) throw new InventoryNotFoundError('No such batch', { batchId: input.batchId });
      if (batch.quantityLeft + input.quantity < 0) {
        throw new NotEnoughStockError(input.itemId, batch.quantityLeft);
      }
      const movement = await this.writer.write({
        actionId: newId(),
        kind: 'adjust',
        itemId: input.itemId,
        branchId: input.branchId,
        shares: [{ batchId: batch.id, quantity: input.quantity }],
        reason: input.reason,
        note: input.note,
        idempotencyKey: key,
        idempotencyHash: hash,
      });
      await this.audit.record({
        action: 'inventory_movement.adjust',
        resourceType: 'inventory_movement',
        resourceId: movement.id,
        after: {
          item: item.name,
          unit: item.unit,
          quantity: input.quantity,
          reason: input.reason,
          lot: batch.lot,
          branchId: input.branchId,
        },
        reason: input.note ?? undefined,
      });
      return (await this.reads.present([movement]))[0] as Movement;
    });
  }

  /** The cost of opening stock entered without one (E); a receipt's lines are priced on it. */
  priceBatch(batchId: string, input: PriceBatch): Promise<void> {
    this.context.requirePermission('inventory:money_manage');
    return this.tenantDb.run(async () => {
      const [batch] = await this.stock.lockBatchesByIds([batchId]);
      if (!batch || batch.source === 'receipt') {
        throw new InventoryNotFoundError('No such opening batch', { batchId });
      }
      const [item] = await this.catalog.itemsByIds([batch.itemId]);
      const packSize = item?.packSize ?? null;
      const pricePer = packSize === null ? 'unit' : input.pricePer;
      const amount = lineAmount(input.price, pricePer, batch.quantity, packSize);
      await this.stock.updateBatch(batchId, { price: input.price, pricePer, amount });
      await this.audit.record({
        action: 'inventory_item.opening_cost',
        resourceType: 'inventory_item',
        resourceId: batch.itemId,
        before: { name: item?.name, price: batch.price, pricePer: batch.pricePer },
        after: { name: item?.name, price: input.price, pricePer, amount, currency: batch.currency },
      });
    });
  }

  /**
   * Opening stock from the import (B8): an opening batch and its movement, only while the item
   * has no batch in the branch, so a second run adds nothing. A cost needs
   * `inventory:money_manage`. Returns whether it added stock.
   */
  importOpening(
    itemId: string,
    branchId: string | null,
    entry: {
      quantity: number;
      unitCost: string | null;
      lot: string | null;
      expiresOn: string | null;
    },
  ): Promise<boolean> {
    this.context.requirePermission('inventory:manage');
    if (entry.unitCost !== null) this.context.requirePermission('inventory:money_manage');
    return this.tenantDb.run(async () => {
      const branch = branchId ?? (await this.calendar.branchIds())[0];
      if (!branch) throw new InventoryNotFoundError('The clinic has no branch');
      await this.calendar.assertBranch(branch);
      // Locks the item: two runs of the import (or a count) never both add opening stock.
      const [item] = await this.catalog.lockItems([itemId]);
      if (!item) throw new InventoryNotFoundError('No such item', { itemId });
      if (item.tracksExpiry && entry.expiresOn === null) {
        throw new ExpiryRequiredError(`${item.name} tracks expiry: give the date`, { itemId });
      }
      if ((await this.stock.lockBatches(itemId, branch)).length > 0) return false;
      const batch = await this.stock.insertBatch({
        itemId,
        branchId: branch,
        source: 'opening',
        receiptId: null,
        position: null,
        lot: entry.lot,
        expiresOn: entry.expiresOn,
        receivedOn: await this.calendar.today(),
        quantity: entry.quantity,
        quantityLeft: 0,
        ...(entry.unitCost === null
          ? { price: null, pricePer: null, amount: null }
          : {
              price: entry.unitCost,
              pricePer: 'unit' as const,
              amount: lineAmount(entry.unitCost, 'unit', entry.quantity, null),
            }),
        currency: await this.calendar.currency(),
      });
      const movement = await this.writer.write({
        actionId: newId(),
        kind: 'opening',
        itemId,
        branchId: branch,
        shares: [{ batchId: batch.id, quantity: entry.quantity }],
      });
      await this.audit.record({
        action: 'inventory_movement.opening',
        resourceType: 'inventory_movement',
        resourceId: movement.id,
        after: { item: item.name, unit: item.unit, quantity: entry.quantity, branchId: branch },
      });
      return true;
    });
  }

  /** Today's Stock card (C2): one count per reason, for the current branch. */
  today(branchId: string): Promise<StockToday> {
    this.context.requirePermission('inventory:read');
    return this.tenantDb.run(async () => {
      await this.calendar.assertBranch(branchId);
      const counts = this.countLabels(await this.reads.branchFacts(branchId));
      return {
        branchId,
        ...counts,
        toPrice: this.context.hasPermission('inventory:money_manage')
          ? await this.stock.toPriceCount(branchId)
          : null,
      };
    });
  }

  /** Item-branch pairs labelled out, low, expired: the dashboard's Needs attention (C4). */
  attention(branchId?: string): Promise<{ out: number; low: number; expired: number }> {
    this.context.requirePermission('inventory:read');
    return this.tenantDb.run(async () => {
      const branches = branchId ? [branchId] : await this.calendar.branchIds();
      let out = 0;
      let low = 0;
      let expired = 0;
      for (const id of branches) {
        const counts = this.countLabels(await this.reads.branchFacts(id));
        out += counts.out;
        low += counts.low;
        expired += counts.expired;
      }
      return { out, low, expired };
    });
  }

  /** The reorder list (B7): low and out items not ordered, by usual supplier. No prices. */
  reorder(branchId: string): Promise<ReorderList> {
    this.context.requirePermission('inventory:read');
    return this.tenantDb.run(async () => {
      await this.calendar.assertBranch(branchId);
      const facts = (await this.reads.branchFacts(branchId)).filter(
        (fact) =>
          fact.item.active &&
          fact.labels.some((label) => label.kind === 'low' || label.kind === 'out'),
      );
      const suppliers = new Map(
        (
          await this.catalog.suppliersByIds([
            ...new Set(facts.flatMap((fact) => fact.item.usualSupplierId ?? [])),
          ])
        ).map((row) => [row.id, row] as const),
      );
      const groups = new Map<string | null, ItemBranchFacts[]>();
      for (const fact of facts) {
        const key = fact.item.usualSupplierId;
        groups.set(key, [...(groups.get(key) ?? []), fact]);
      }
      return {
        branchId,
        groups: [...groups.entries()]
          .map(([supplierId, rows]) => {
            const supplier = supplierId ? suppliers.get(supplierId) : undefined;
            return {
              supplierId,
              supplierName: supplier?.name ?? null,
              email: supplier?.email ?? null,
              phone: supplier?.phone ?? null,
              items: rows.map((fact) => ({
                itemId: fact.item.id,
                name: fact.item.name,
                code: fact.item.code,
                unit: fact.item.unit,
                packName: fact.item.packName,
                packSize: fact.item.packSize,
                onHand: fact.onHand,
                reorderLevel: fact.reorderLevel,
                proposed: fact.item.usualOrderPacks,
              })),
            };
          })
          .sort((a, b) =>
            a.supplierName === null
              ? 1
              : b.supplierName === null
                ? -1
                : a.supplierName.localeCompare(b.supplierName),
          ),
      };
    });
  }

  /** The currency lock: a priced batch is inventory money. */
  hasPricedStock(): Promise<boolean> {
    return this.tenantDb.run(() => this.stock.anyPricedBatch());
  }

  // --- Helpers ---

  private countLabels(facts: readonly ItemBranchFacts[]) {
    const counts = { out: 0, expired: 0, low: 0, expiring: 0, toCount: 0 };
    for (const fact of facts) {
      for (const label of fact.labels) {
        if (label.kind === 'out') counts.out += 1;
        if (label.kind === 'expired') counts.expired += 1;
        if (label.kind === 'low') counts.low += 1;
        if (label.kind === 'expiring') counts.expiring += 1;
        if (label.kind === 'to_count') counts.toCount += 1;
      }
    }
    return counts;
  }

  private allocateOrRefuse(
    itemId: string,
    batches: readonly StoredBatch[],
    quantity: number,
    batchId: string | null,
  ): BatchShare[] {
    const states = batches.map((batch) => ({
      id: batch.id,
      expiresOn: batch.expiresOn,
      receivedOn: batch.receivedOn,
      left: batch.quantityLeft,
    }));
    if (batchId !== null && !states.some((batch) => batch.id === batchId)) {
      throw new InventoryNotFoundError('No such batch', { batchId });
    }
    const shares = allocate(states, quantity, batchId);
    if (!shares) throw new NotEnoughStockError(itemId, onHandOf(states));
    return shares;
  }

  private warnExpired(
    itemId: string,
    batches: readonly StoredBatch[],
    shares: readonly BatchShare[],
    today: string,
  ): void {
    for (const share of shares) {
      const batch = batches.find((candidate) => candidate.id === share.batchId);
      if (batch?.expiresOn && batch.expiresOn < today) {
        throw new ExpiredBatchError(itemId, batch.id, batch.expiresOn);
      }
    }
  }

  private async requireActive(ids: readonly string[]): Promise<Map<string, StoredItem>> {
    const items = new Map(
      (await this.catalog.itemsByIds(ids)).map((item) => [item.id, item] as const),
    );
    for (const id of ids) {
      const item = items.get(id);
      if (!item) throw new InventoryNotFoundError('No such item', { itemId: id });
      if (!item.active) throw new InventoryInactiveError(`${item.name} is inactive`);
    }
    return items;
  }

  private async requireReversible(movementId: string): Promise<StoredMovement> {
    const movement = await this.stock.movement(movementId, true);
    if (!movement) throw new InventoryNotFoundError('No such movement', { movementId });
    if (movement.kind !== 'take_out' || movement.reversedAt !== null) {
      throw new MovementNotReversibleError('Only a take-out not yet reversed goes back');
    }
    return movement;
  }

  private async reverseRow(
    movement: StoredMovement,
    reason: string | null,
    verb: 'undo' | 'reverse',
  ): Promise<Movement> {
    const shares = await this.stock.sharesOf([movement.id]);
    await this.stock.lockBatchesByIds(shares.map((share) => share.batchId));
    const reversal = await this.writer.write({
      actionId: movement.actionId,
      kind: 'reversal',
      itemId: movement.itemId,
      branchId: movement.branchId,
      shares: shares.map((share) => ({ batchId: share.batchId, quantity: -share.quantity })),
      reversesId: movement.id,
      note: reason,
    });
    await this.stock.markReversed(
      movement.id,
      this.calendar.now(),
      this.context.requireUserId(),
      reason,
    );
    const [item] = await this.catalog.itemsByIds([movement.itemId]);
    await this.audit.record({
      action: `inventory_movement.${verb}`,
      resourceType: 'inventory_movement',
      resourceId: movement.id,
      before: { reversed: false },
      after: {
        reversed: true,
        item: item?.name ?? '',
        unit: item?.unit ?? '',
        quantity: -movement.quantity,
        branchId: movement.branchId,
      },
      reason: reason ?? undefined,
    });
    return (await this.reads.present([reversal]))[0] as Movement;
  }

  private mismatch(): InventoryIdempotencyMismatchError {
    return new InventoryIdempotencyMismatchError(
      'This Idempotency-Key was used for a different request',
    );
  }
}
