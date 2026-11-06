import {
  confirmItemsSchema,
  createExpenseCategorySchema,
  createFixedExpenseSchema,
  expenseCategorySchema,
  expenseDashboardSchema,
  expenseExportQuerySchema,
  expenseListQuerySchema,
  expensePageSchema,
  expenseReasonSchema,
  expenseSchema,
  expenseYearQuerySchema,
  expenseYearSchema,
  fixedExpenseDetailSchema,
  fixedExpenseSchema,
  fixedItemSchema,
  idSchema,
  recordExpenseSchema,
  skipItemSchema,
  updateExpenseCategorySchema,
  updateExpenseSchema,
  updateFixedExpenseSchema,
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
  Query,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiProduces } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { idempotencyKey } from '../../../platform/http/idempotency-key';
import { RequirePermission } from '../../../platform/http/route-access';
import { CategoriesService } from '../application/categories.service';
import { type CsvFile, ExpensesService } from '../application/expenses.service';
import { FixedExpensesService } from '../application/fixed-expenses.service';

class CategoryDto extends createZodDto(expenseCategorySchema) {}
class CategoryListDto extends createZodDto(z.array(expenseCategorySchema)) {}
class CreateCategoryDto extends createZodDto(createExpenseCategorySchema) {}
class UpdateCategoryDto extends createZodDto(updateExpenseCategorySchema) {}
class ExpenseDto extends createZodDto(expenseSchema) {}
class ExpenseListDto extends createZodDto(z.array(expenseSchema)) {}
class ExpensePageDto extends createZodDto(expensePageSchema) {}
class ListQueryDto extends createZodDto(expenseListQuerySchema) {}
class ExportQueryDto extends createZodDto(expenseExportQuerySchema) {}
class YearQueryDto extends createZodDto(expenseYearQuerySchema) {}
class YearDto extends createZodDto(expenseYearSchema) {}
class RecordExpenseDto extends createZodDto(recordExpenseSchema) {}
class UpdateExpenseDto extends createZodDto(updateExpenseSchema) {}
class ReasonDto extends createZodDto(expenseReasonSchema) {}
class DashboardDto extends createZodDto(expenseDashboardSchema) {}
class ItemDto extends createZodDto(fixedItemSchema) {}
class ItemListDto extends createZodDto(z.array(fixedItemSchema)) {}
class ConfirmItemsDto extends createZodDto(confirmItemsSchema) {}
class SkipItemDto extends createZodDto(skipItemSchema) {}
class FixedListDto extends createZodDto(z.array(fixedExpenseSchema)) {}
class FixedDetailDto extends createZodDto(fixedExpenseDetailSchema) {}
class CreateFixedDto extends createZodDto(createFixedExpenseSchema) {}
class UpdateFixedDto extends createZodDto(updateFixedExpenseSchema) {}
class IdParamsDto extends createZodDto(z.object({ id: idSchema })) {}

function sendCsv(response: Response, file: CsvFile): void {
  response.status(200);
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.send(file.body);
}

/**
 * What the clinic spends (feature 17, docs/modules/expenses.md): every read needs
 * `expense:read`, every change `expense:manage`.
 */
@Controller('expenses')
export class ExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly categories: CategoriesService,
    private readonly fixed: FixedExpensesService,
  ) {}

  // --- Categories ---

  @Get('categories')
  @RequirePermission('expense:read')
  @ZodResponse({ type: CategoryListDto })
  listCategories() {
    return this.categories.list();
  }

  @Post('categories')
  @RequirePermission('expense:manage')
  @ZodResponse({ status: 201, type: CategoryDto })
  createCategory(@Body() body: CreateCategoryDto) {
    return this.categories.create(body);
  }

  @Patch('categories/:id')
  @RequirePermission('expense:manage')
  @ZodResponse({ type: CategoryDto })
  updateCategory(@Param() params: IdParamsDto, @Body() body: UpdateCategoryDto) {
    return this.categories.update(params.id, body);
  }

  @Delete('categories/:id')
  @RequirePermission('expense:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCategory(@Param() params: IdParamsDto) {
    return this.categories.delete(params.id);
  }

  // --- Expenses ---

  @Get()
  @RequirePermission('expense:read')
  @ZodResponse({ type: ExpensePageDto })
  list(@Query() query: ListQueryDto) {
    return this.expenses.list(query);
  }

  @Get('year')
  @RequirePermission('expense:read')
  @ZodResponse({ type: YearDto })
  year(@Query() query: YearQueryDto) {
    return this.expenses.year(query.year);
  }

  @Get('export')
  @RequirePermission('expense:read')
  @ApiProduces('text/csv')
  async export(@Query() query: ExportQueryDto, @Res() response: Response): Promise<void> {
    sendCsv(response, await this.expenses.export(query));
  }

  @Get('dashboard')
  @RequirePermission('expense:read')
  @ZodResponse({ type: DashboardDto })
  dashboard() {
    return this.expenses.dashboard();
  }

  @Post()
  @RequirePermission('expense:manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 201, type: ExpenseDto })
  record(@Body() body: RecordExpenseDto, @Headers('idempotency-key') key: string | undefined) {
    return this.expenses.record(body, idempotencyKey(key));
  }

  @Patch(':id')
  @RequirePermission('expense:manage')
  @ZodResponse({ type: ExpenseDto })
  update(@Param() params: IdParamsDto, @Body() body: UpdateExpenseDto) {
    return this.expenses.update(params.id, body);
  }

  @Post(':id/void')
  @HttpCode(200)
  @RequirePermission('expense:manage')
  @ZodResponse({ status: 200, type: ExpenseDto })
  void(@Param() params: IdParamsDto, @Body() body: ReasonDto) {
    return this.expenses.void(params.id, body);
  }

  // --- Waiting for confirmation ---

  @Get('pending')
  @RequirePermission('expense:read')
  @ZodResponse({ type: ItemListDto })
  pending() {
    return this.fixed.pending();
  }

  @Post('pending/confirm')
  @HttpCode(200)
  @RequirePermission('expense:manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 200, type: ExpenseListDto })
  confirm(@Body() body: ConfirmItemsDto, @Headers('idempotency-key') key: string | undefined) {
    return this.fixed.confirm(body, idempotencyKey(key));
  }

  @Post('pending/:id/skip')
  @HttpCode(200)
  @RequirePermission('expense:manage')
  @ZodResponse({ status: 200, type: ItemDto })
  skip(@Param() params: IdParamsDto, @Body() body: SkipItemDto) {
    return this.fixed.skip(params.id, body);
  }

  @Post('pending/:id/unskip')
  @HttpCode(200)
  @RequirePermission('expense:manage')
  @ZodResponse({ status: 200, type: ItemDto })
  unskip(@Param() params: IdParamsDto) {
    return this.fixed.unskip(params.id);
  }

  // --- Fixed expenses ---

  @Get('fixed')
  @RequirePermission('expense:read')
  @ZodResponse({ type: FixedListDto })
  listFixed() {
    return this.fixed.list();
  }

  @Get('fixed/:id')
  @RequirePermission('expense:read')
  @ZodResponse({ type: FixedDetailDto })
  getFixed(@Param() params: IdParamsDto) {
    return this.fixed.get(params.id);
  }

  @Post('fixed')
  @RequirePermission('expense:manage')
  @ZodResponse({ status: 201, type: FixedDetailDto })
  createFixed(@Body() body: CreateFixedDto) {
    return this.fixed.create(body);
  }

  @Patch('fixed/:id')
  @RequirePermission('expense:manage')
  @ZodResponse({ type: FixedDetailDto })
  updateFixed(@Param() params: IdParamsDto, @Body() body: UpdateFixedDto) {
    return this.fixed.update(params.id, body);
  }

  @Post('fixed/:id/pause')
  @HttpCode(200)
  @RequirePermission('expense:manage')
  @ZodResponse({ status: 200, type: FixedDetailDto })
  pause(@Param() params: IdParamsDto) {
    return this.fixed.pause(params.id);
  }

  @Post('fixed/:id/resume')
  @HttpCode(200)
  @RequirePermission('expense:manage')
  @ZodResponse({ status: 200, type: FixedDetailDto })
  resume(@Param() params: IdParamsDto) {
    return this.fixed.resume(params.id);
  }

  @Post('fixed/:id/end')
  @HttpCode(200)
  @RequirePermission('expense:manage')
  @ZodResponse({ status: 200, type: FixedDetailDto })
  end(@Param() params: IdParamsDto) {
    return this.fixed.end(params.id);
  }
}
