import {
  importPatientsRequestSchema,
  importResultSchema,
  importServicesRequestSchema,
  importVisitsRequestSchema,
} from '@dcm/contracts';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { ImportsService } from '../application/imports.service';

class ImportServicesDto extends createZodDto(importServicesRequestSchema) {}
class ImportPatientsDto extends createZodDto(importPatientsRequestSchema) {}
class ImportVisitsDto extends createZodDto(importVisitsRequestSchema) {}
class ImportResultDto extends createZodDto(importResultSchema) {}

/**
 * The import APIs (feature 6, ADR-0053): 200 with a result per row, whatever each row did — a
 * failed row is in the results, not an error of the request.
 */
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post('services')
  @RequirePermission('import:run')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: ImportResultDto })
  services(@Body() body: ImportServicesDto) {
    return this.imports.importServices(body);
  }

  @Post('patients')
  @RequirePermission('import:run')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: ImportResultDto })
  patients(@Body() body: ImportPatientsDto) {
    return this.imports.importPatients(body);
  }

  @Post('visits')
  @RequirePermission('import:run')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: ImportResultDto })
  visits(@Body() body: ImportVisitsDto) {
    return this.imports.importVisits(body);
  }
}
