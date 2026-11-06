import {
  changeSalarySchema,
  confirmLinesSchema,
  createEmployeeSchema,
  employeeDetailSchema,
  employeeListQuerySchema,
  employeeSchema,
  idSchema,
  linkableStaffSchema,
  monthSchema,
  payrollExportQuerySchema,
  payrollLineSchema,
  payrollMonthsSchema,
  payrollReasonSchema,
  payrollRunSchema,
  payrollYearExportQuerySchema,
  payrollYearQuerySchema,
  setAdjustmentsSchema,
  updateEmployeeSchema,
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
import { EmployeesService } from '../application/employees.service';
import { type CsvFile, PayrollRunsService } from '../application/payroll-runs.service';

class EmployeeListDto extends createZodDto(z.array(employeeSchema)) {}
class EmployeeListQueryDto extends createZodDto(employeeListQuerySchema) {}
class EmployeeDetailDto extends createZodDto(employeeDetailSchema) {}
class CreateEmployeeDto extends createZodDto(createEmployeeSchema) {}
class UpdateEmployeeDto extends createZodDto(updateEmployeeSchema) {}
class ChangeSalaryDto extends createZodDto(changeSalarySchema) {}
class StaffListDto extends createZodDto(z.array(linkableStaffSchema)) {}
class RunDto extends createZodDto(payrollRunSchema) {}
class LineDto extends createZodDto(payrollLineSchema) {}
class LineListDto extends createZodDto(z.array(payrollLineSchema)) {}
class SetAdjustmentsDto extends createZodDto(setAdjustmentsSchema) {}
class ConfirmLinesDto extends createZodDto(confirmLinesSchema) {}
class ReasonDto extends createZodDto(payrollReasonSchema) {}
class MonthsDto extends createZodDto(payrollMonthsSchema) {}
class YearQueryDto extends createZodDto(payrollYearQuerySchema) {}
class YearExportQueryDto extends createZodDto(payrollYearExportQuerySchema) {}
class ExportQueryDto extends createZodDto(payrollExportQuerySchema) {}
class IdParamsDto extends createZodDto(z.object({ id: idSchema })) {}
class MonthParamsDto extends createZodDto(z.object({ month: monthSchema })) {}
class LineParamsDto extends createZodDto(z.object({ month: monthSchema, employeeId: idSchema })) {}

function sendCsv(response: Response, file: CsvFile): void {
  response.status(200);
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.send(file.body);
}

/**
 * Employees, salaries and the monthly payroll run (feature 17, docs/modules/payroll.md): every
 * read needs `payroll:read`, every change `payroll:manage`. A platform admin holds neither.
 */
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly runs: PayrollRunsService,
  ) {}

  // --- Employees ---

  @Get('employees')
  @RequirePermission('payroll:read')
  @ZodResponse({ type: EmployeeListDto })
  listEmployees(@Query() query: EmployeeListQueryDto) {
    return this.employees.list(query);
  }

  @Get('staff')
  @RequirePermission('payroll:read')
  @ZodResponse({ type: StaffListDto })
  staff() {
    return this.employees.staff();
  }

  @Post('employees')
  @RequirePermission('payroll:manage')
  @ZodResponse({ status: 201, type: EmployeeDetailDto })
  createEmployee(@Body() body: CreateEmployeeDto) {
    return this.employees.create(body);
  }

  @Get('employees/:id')
  @RequirePermission('payroll:read')
  @ZodResponse({ type: EmployeeDetailDto })
  employee(@Param() params: IdParamsDto) {
    return this.employees.detail(params.id);
  }

  @Patch('employees/:id')
  @RequirePermission('payroll:manage')
  @ZodResponse({ type: EmployeeDetailDto })
  updateEmployee(@Param() params: IdParamsDto, @Body() body: UpdateEmployeeDto) {
    return this.employees.update(params.id, body);
  }

  @Delete('employees/:id')
  @RequirePermission('payroll:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeEmployee(@Param() params: IdParamsDto) {
    return this.employees.remove(params.id);
  }

  @Post('employees/:id/salaries')
  @RequirePermission('payroll:manage')
  @ZodResponse({ status: 201, type: EmployeeDetailDto })
  changeSalary(@Param() params: IdParamsDto, @Body() body: ChangeSalaryDto) {
    return this.employees.changeSalary(params.id, body);
  }

  @Get('employees/:id/export')
  @RequirePermission('payroll:read')
  @ApiProduces('text/csv')
  async exportEmployee(
    @Param() params: IdParamsDto,
    @Query() query: ExportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    sendCsv(response, await this.runs.exportEmployee(params.id, query.lang));
  }

  // --- Runs ---

  @Get('runs/:month')
  @RequirePermission('payroll:read')
  @ZodResponse({ type: RunDto })
  run(@Param() params: MonthParamsDto) {
    return this.runs.run(params.month);
  }

  @Put('runs/:month/lines/:employeeId/adjustments')
  @RequirePermission('payroll:manage')
  @ZodResponse({ type: LineDto })
  setAdjustments(@Param() params: LineParamsDto, @Body() body: SetAdjustmentsDto) {
    return this.runs.setAdjustments(params.employeeId, params.month, body);
  }

  @Post('confirm')
  @HttpCode(200)
  @RequirePermission('payroll:manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 200, type: LineListDto })
  confirm(@Body() body: ConfirmLinesDto, @Headers('idempotency-key') key: string | undefined) {
    return this.runs.confirm(body, idempotencyKey(key));
  }

  @Post('runs/:month/lines/:employeeId/skip')
  @HttpCode(200)
  @RequirePermission('payroll:manage')
  @ZodResponse({ status: 200, type: LineDto })
  skip(@Param() params: LineParamsDto, @Body() body: ReasonDto) {
    return this.runs.skip(params.employeeId, params.month, body.reason);
  }

  @Post('runs/:month/lines/:employeeId/unskip')
  @HttpCode(200)
  @RequirePermission('payroll:manage')
  @ZodResponse({ status: 200, type: LineDto })
  unskip(@Param() params: LineParamsDto) {
    return this.runs.unskip(params.employeeId, params.month);
  }

  @Post('runs/:month/lines/:employeeId/void')
  @HttpCode(200)
  @RequirePermission('payroll:manage')
  @ZodResponse({ status: 200, type: LineDto })
  void(@Param() params: LineParamsDto, @Body() body: ReasonDto) {
    return this.runs.void(params.employeeId, params.month, body.reason);
  }

  // --- Months ---

  @Get('months')
  @RequirePermission('payroll:read')
  @ZodResponse({ type: MonthsDto })
  months(@Query() query: YearQueryDto) {
    return this.runs.months(query.year);
  }

  @Get('months/export')
  @RequirePermission('payroll:read')
  @ApiProduces('text/csv')
  async exportMonths(@Query() query: YearExportQueryDto, @Res() response: Response): Promise<void> {
    sendCsv(response, await this.runs.exportMonths(query.year, query.lang));
  }
}
