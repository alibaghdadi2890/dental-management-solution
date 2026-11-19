import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { CountsService } from './application/counts.service';
import {
  InventoryCategorySeedingSubscriber,
  InventoryCurrencyLockSubscriber,
} from './application/inventory.subscribers';
import { InventoryCalendar } from './application/inventory-calendar';
import { ItemsService } from './application/items.service';
import { MovementWriter } from './application/movement-writer';
import { ReceiptsService } from './application/receipts.service';
import { InventoryReportsService } from './application/reports.service';
import { StockReads } from './application/stock-reads';
import { StockService } from './application/stock.service';
import { SuppliersService } from './application/suppliers.service';
import { CountsController, SuppliersController } from './http/counts-suppliers.controller';
import { InventoryController } from './http/inventory.controller';
import { ReceiptsController } from './http/receipts.controller';
import { CatalogRepository } from './persistence/catalog.repository';
import { MoneyRepository } from './persistence/money.repository';
import { StockRepository } from './persistence/stock.repository';

/**
 * See docs/modules/inventory.md and ADR-0094 to ADR-0101. Depends on `tenancy` (currency, time
 * zone, branches, locale), `users` (names) and `audit` only; object storage comes from the global
 * `StorageModule`. Consumes `TenantProvisioned` (the categories) and vetoes a currency change once
 * inventory money exists. `expenses` imports its payment events; `imports` and `dashboards` its
 * services. Nothing else imports it.
 */
@Module({
  imports: [AuditModule, TenancyModule, UsersModule],
  controllers: [InventoryController, ReceiptsController, CountsController, SuppliersController],
  providers: [
    InventoryCalendar,
    MovementWriter,
    StockReads,
    ItemsService,
    SuppliersService,
    ReceiptsService,
    StockService,
    CountsService,
    InventoryReportsService,
    InventoryCategorySeedingSubscriber,
    InventoryCurrencyLockSubscriber,
    CatalogRepository,
    StockRepository,
    MoneyRepository,
  ],
  exports: [
    ItemsService,
    SuppliersService,
    ReceiptsService,
    StockService,
    CountsService,
    InventoryReportsService,
  ],
})
export class InventoryModule {}
