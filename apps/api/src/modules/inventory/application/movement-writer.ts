import type { MovementKind, MovementReason } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import type { BatchShare } from '../domain/stock';
import { type StoredMovement, StockRepository } from '../persistence/stock.repository';
import { InventoryCalendar } from './inventory-calendar';

export interface MovementInput {
  actionId: string;
  kind: MovementKind;
  itemId: string;
  branchId: string;
  shares: readonly BatchShare[];
  reason?: MovementReason | null;
  note?: string | null;
  receiptId?: string | null;
  countId?: string | null;
  reversesId?: string | null;
  idempotencyKey?: string | null;
  idempotencyHash?: string | null;
}

/**
 * The only writer of stock (ADR-0095): one movement, its batch shares, and the batches' quantity
 * left, together, in the caller's transaction, under the caller's lock on those batches. Dated
 * the clinic's today and by the signed-in user.
 */
@Injectable()
export class MovementWriter {
  constructor(
    private readonly context: RequestContext,
    private readonly calendar: InventoryCalendar,
    private readonly stock: StockRepository,
  ) {}

  async write(input: MovementInput): Promise<StoredMovement> {
    const quantity = input.shares.reduce((sum, share) => sum + share.quantity, 0);
    const row = await this.stock.insertMovement(
      {
        actionId: input.actionId,
        kind: input.kind,
        itemId: input.itemId,
        branchId: input.branchId,
        quantity,
        reason: input.reason ?? null,
        note: input.note ?? null,
        occurredOn: await this.calendar.today(),
        receiptId: input.receiptId ?? null,
        countId: input.countId ?? null,
        reversesId: input.reversesId ?? null,
        createdBy: this.context.requireUserId(),
        idempotencyKey: input.idempotencyKey ?? null,
        idempotencyHash: input.idempotencyHash ?? null,
      },
      input.shares,
    );
    await this.stock.applyShares(input.shares);
    return row;
  }
}
