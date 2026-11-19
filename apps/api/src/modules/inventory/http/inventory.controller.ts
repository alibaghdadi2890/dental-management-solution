import {
  adjustStockSchema,
  branchBodySchema,
  createInventoryCategorySchema,
  idSchema,
  inventoryCategorySchema,
  inventoryItemSchema,
  inventoryReportQuerySchema,
  inventoryReportSchema,
  inventorySettingsSchema,
  itemBranchLevelSchema,
  itemDetailSchema,
  markOrderedManySchema,
  markOrderedSchema,
  movementListQuerySchema,
  movementPageSchema,
  movementSchema,
  priceBatchSchema,
  reorderListSchema,
  reorderQuerySchema,
  reverseMovementSchema,
  saveItemsSchema,
  stockListSchema,
  stockQuerySchema,
  stockTodayQuerySchema,
  stockTodaySchema,
  supplierPaymentSchema,
  takeOutResultSchema,
  takeOutSchema,
  updateInventoryCategorySchema,
  voidSupplierPaymentSchema,
} from '@dcm/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiProduces } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { idempotencyKey } from '../../../platform/http/idempotency-key';
import { RequirePermission } from '../../../platform/http/route-access';
import { ItemsService } from '../application/items.service';
import { InventoryReportsService } from '../application/reports.service';
import { StockService } from '../application/stock.service';
import type { CsvFile } from '../application/suppliers.service';
import { SuppliersService } from '../application/suppliers.service';

class CategoryDto extends createZodDto(inventoryCategorySchema) {}
class CategoryListDto extends createZodDto(z.array(inventoryCategorySchema)) {}
class CreateCategoryDto extends createZodDto(createInventoryCategorySchema) {}
class UpdateCategoryDto extends createZodDto(updateInventoryCategorySchema) {}
class ItemListDto extends createZodDto(z.array(inventoryItemSchema)) {}
class SaveItemsDto extends createZodDto(saveItemsSchema) {}
class ItemDetailDto extends createZodDto(itemDetailSchema) {}
class BranchLevelDto extends createZodDto(itemBranchLevelSchema) {}
class MarkOrderedDto extends createZodDto(markOrderedSchema) {}
class MarkOrderedManyDto extends createZodDto(markOrderedManySchema) {}
class BranchBodyDto extends createZodDto(branchBodySchema) {}
class StockQueryDto extends createZodDto(stockQuerySchema) {}
class StockListDto extends createZodDto(stockListSchema) {}
class TodayQueryDto extends createZodDto(stockTodayQuerySchema) {}
class TodayDto extends createZodDto(stockTodaySchema) {}
class ReorderQueryDto extends createZodDto(reorderQuerySchema) {}
class ReorderDto extends createZodDto(reorderListSchema) {}
class MovementQueryDto extends createZodDto(movementListQuerySchema) {}
class MovementPageDto extends createZodDto(movementPageSchema) {}
class MovementDto extends createZodDto(movementSchema) {}
class TakeOutDto extends createZodDto(takeOutSchema) {}
class TakeOutResultDto extends createZodDto(takeOutResultSchema) {}
class ReverseDto extends createZodDto(reverseMovementSchema) {}
class AdjustDto extends createZodDto(adjustStockSchema) {}
class PriceBatchDto extends createZodDto(priceBatchSchema) {}
class SettingsDto extends createZodDto(inventorySettingsSchema) {}
class ReportQueryDto extends createZodDto(inventoryReportQuerySchema) {}
class ReportDto extends createZodDto(inventoryReportSchema) {}
class PaymentDto extends createZodDto(supplierPaymentSchema) {}
class VoidPaymentDto extends createZodDto(voidSupplierPaymentSchema) {}
class IdParamsDto extends createZodDto(z.object({ id: idSchema })) {}
class ItemBranchParamsDto extends createZodDto(z.object({ id: idSchema, branchId: idSchema })) {}

export function sendCsv(response: Response, file: CsvFile): void {
  response.status(200);
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.send(file.body);
}

/**
 * Items, categories, stock, movements, Today's counts, the reorder list, settings and reports
 * (feature 20a; docs/modules/inventory.md). Reads need `inventory:read`; taking out and _Report
 * wrong count_ `inventory:write`; everything that manages stock `inventory:manage`; costs and
 * money `inventory:money_*` (ADR-0101). Each service re-checks.
 */
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly items: ItemsService,
    private readonly stock: StockService,
    private readonly reports: InventoryReportsService,
    private readonly suppliers: SuppliersService,
  ) {}

  // --- Categories and items ---

  @Get('categories')
  @RequirePermission('inventory:read')
  @ZodResponse({ type: CategoryListDto })
  categories() {
    return this.items.categories();
  }

  @Post('categories')
  @RequirePermission('inventory:manage')
  @ZodResponse({ status: 201, type: CategoryDto })
  createCategory(@Body() body: CreateCategoryDto) {
    return this.items.createCategory(body);
  }

  @Patch('categories/:id')
  @RequirePermission('inventory:manage')
  @ZodResponse({ type: CategoryDto })
  updateCategory(@Param() params: IdParamsDto, @Body() body: UpdateCategoryDto) {
    return this.items.updateCategory(params.id, body);
  }

  @Delete('categories/:id')
  @RequirePermission('inventory:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCategory(@Param() params: IdParamsDto) {
    return this.items.deleteCategory(params.id);
  }

  @Get('items')
  @RequirePermission('inventory:read')
  @ZodResponse({ type: ItemListDto })
  listItems() {
    return this.items.items();
  }

  @Put('items')
  @RequirePermission('inventory:manage')
  @ZodResponse({ type: ItemListDto })
  saveItems(@Body() body: SaveItemsDto) {
    return this.items.saveItems(body);
  }

  @Get('items/:id')
  @RequirePermission('inventory:read')
  @ZodResponse({ type: ItemDetailDto })
  item(@Param() params: IdParamsDto) {
    return this.stock.item(params.id);
  }

  @Put('items/:id/branches/:branchId')
  @RequirePermission('inventory:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  setBranchLevel(@Param() params: ItemBranchParamsDto, @Body() body: BranchLevelDto) {
    return this.items.setBranchLevel(params.id, params.branchId, body);
  }

  @Put('items/:id/branches/:branchId/ordered')
  @RequirePermission('inventory:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  markOrdered(@Param() params: ItemBranchParamsDto, @Body() body: MarkOrderedDto) {
    return this.items.markOrdered(params.id, params.branchId, body);
  }

  @Delete('items/:id/branches/:branchId/ordered')
  @RequirePermission('inventory:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  unmarkOrdered(@Param() params: ItemBranchParamsDto) {
    return this.items.unmarkOrdered(params.id, params.branchId);
  }

  @Post('items/:id/report-count')
  @RequirePermission('inventory:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  reportCount(@Param() params: IdParamsDto, @Body() body: BranchBodyDto) {
    return this.items.reportCount(params.id, body.branchId);
  }

  @Post('reorder/ordered')
  @RequirePermission('inventory:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  markOrderedMany(@Body() body: MarkOrderedManyDto) {
    return this.items.markOrderedMany(body);
  }

  @Get('settings')
  @RequirePermission('inventory:read')
  @ZodResponse({ type: SettingsDto })
  settings() {
    return this.items.settings();
  }

  @Put('settings')
  @RequirePermission('inventory:manage')
  @ZodResponse({ type: SettingsDto })
  updateSettings(@Body() body: SettingsDto) {
    return this.items.updateSettings(body);
  }

  // --- Stock ---

  @Get('stock')
  @RequirePermission('inventory:read')
  @ZodResponse({ type: StockListDto })
  stockList(@Query() query: StockQueryDto) {
    return this.stock.list(query);
  }

  @Get('stock/export')
  @RequirePermission('inventory:read')
  @ApiProduces('text/csv')
  async exportStock(@Query() query: StockQueryDto, @Res() response: Response): Promise<void> {
    sendCsv(response, await this.stock.export(query));
  }

  @Get('today')
  @RequirePermission('inventory:read')
  @ZodResponse({ type: TodayDto })
  today(@Query() query: TodayQueryDto) {
    return this.stock.today(query.branchId);
  }

  @Get('reorder')
  @RequirePermission('inventory:read')
  @ZodResponse({ type: ReorderDto })
  reorder(@Query() query: ReorderQueryDto) {
    return this.stock.reorder(query.branchId);
  }

  @Get('movements')
  @RequirePermission('inventory:read')
  @ZodResponse({ type: MovementPageDto })
  movements(@Query() query: MovementQueryDto) {
    return this.stock.movements(query);
  }

  @Post('take-outs')
  @RequirePermission('inventory:write')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 201, type: TakeOutResultDto })
  takeOut(@Body() body: TakeOutDto, @Headers('idempotency-key') key: string | undefined) {
    return this.stock.takeOut(body, idempotencyKey(key));
  }

  @Post('movements/:id/undo')
  @HttpCode(200)
  @RequirePermission('inventory:write')
  @ZodResponse({ type: MovementDto })
  undo(@Param() params: IdParamsDto) {
    return this.stock.undo(params.id);
  }

  @Post('movements/:id/reverse')
  @HttpCode(200)
  @RequirePermission('inventory:manage')
  @ZodResponse({ type: MovementDto })
  reverse(@Param() params: IdParamsDto, @Body() body: ReverseDto) {
    return this.stock.reverse(params.id, body.reason);
  }

  @Post('adjustments')
  @RequirePermission('inventory:manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 201, type: MovementDto })
  adjust(@Body() body: AdjustDto, @Headers('idempotency-key') key: string | undefined) {
    return this.stock.adjust(body, idempotencyKey(key));
  }

  @Put('batches/:id/price')
  @RequirePermission('inventory:money_manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  priceBatch(@Param() params: IdParamsDto, @Body() body: PriceBatchDto) {
    return this.stock.priceBatch(params.id, body);
  }

  @Post('payments/:id/void')
  @HttpCode(200)
  @RequirePermission('inventory:money_manage')
  @ZodResponse({ type: PaymentDto })
  voidPayment(@Param() params: IdParamsDto, @Body() body: VoidPaymentDto) {
    return this.suppliers.voidPayment(params.id, body.reason);
  }

  @Get('reports')
  @RequirePermission('inventory:read')
  @ZodResponse({ type: ReportDto })
  report(@Query() query: ReportQueryDto) {
    return this.reports.report(query);
  }
}
