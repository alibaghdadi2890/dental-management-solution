import type { Lab, LabAdjustment, LabPayment } from '@dcm/contracts';
import type {
  StoredAdjustment,
  StoredLab,
  StoredPayment,
  StoredService,
} from '../persistence/labs.repository';
import type { StoredItem } from '../persistence/orders.repository';

/** A lab with its price list; prices and the opening balance only with lab money (O8). */
export function toLab(row: StoredLab, services: readonly StoredService[], withMoney: boolean): Lab {
  return {
    id: row.id,
    name: row.name,
    contactPerson: row.contactPerson,
    phone: row.phone,
    email: row.email,
    address: row.address,
    deliveryMethods: row.deliveryMethods,
    portalUrl: row.portalUrl,
    turnaroundDays: row.turnaroundDays,
    note: row.note,
    active: row.active,
    services: services.map((service) => ({
      id: service.id,
      labId: service.labId,
      name: service.name,
      price: withMoney ? service.price : null,
      currency: service.currency,
      turnaroundDays: service.turnaroundDays,
      active: service.active,
    })),
    openingBalance: withMoney ? row.openingBalance : null,
    openingBalanceOn: withMoney ? row.openingBalanceOn : null,
  };
}

export function toPayment(row: StoredPayment): LabPayment {
  return {
    id: row.id,
    labId: row.labId,
    paidOn: row.paidOn,
    amount: row.amount,
    currency: row.currency,
    method: row.method,
    reference: row.reference,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
  };
}

export function toAdjustment(row: StoredAdjustment): LabAdjustment {
  return {
    id: row.id,
    labId: row.labId,
    onDate: row.onDate,
    kind: row.kind,
    amount: row.amount,
    currency: row.currency,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

/** "2 × Zirconia crown, Night guard": an order's items in one line (statements, audit, slips). */
export function itemsText(items: readonly Pick<StoredItem, 'description' | 'quantity'>[]): string {
  return items
    .map((item) =>
      item.quantity > 1 ? `${String(item.quantity)} × ${item.description}` : item.description,
    )
    .join(', ');
}
