// Public API of the inventory module. Other modules import from this file only (CLAUDE.md §4).
export { InventoryModule } from './inventory.module';
export { CountsService } from './application/counts.service';
export { ItemsService } from './application/items.service';
export { ReceiptsService } from './application/receipts.service';
export { InventoryReportsService } from './application/reports.service';
export { StockService } from './application/stock.service';
export { SuppliersService } from './application/suppliers.service';
export {
  SUPPLIER_PAYMENT_RECORDED,
  SUPPLIER_PAYMENT_VOIDED,
  type SupplierPaymentRecorded,
  type SupplierPaymentVoided,
} from './events/inventory-events';
