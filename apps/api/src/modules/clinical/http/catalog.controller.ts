import {
  catalogSeedResultSchema,
  diagnosisBatchSchema,
  diagnosisItemSchema,
  idSchema,
  serviceBatchSchema,
  serviceItemSchema,
} from '@dcm/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { CatalogService } from '../application/catalog.service';

class ServiceItemDto extends createZodDto(serviceItemSchema) {}
class ServiceBatchDto extends createZodDto(serviceBatchSchema) {}
class DiagnosisItemDto extends createZodDto(diagnosisItemSchema) {}
class DiagnosisBatchDto extends createZodDto(diagnosisBatchSchema) {}
class CatalogSeedResultDto extends createZodDto(catalogSeedResultSchema) {}
class CatalogParamsDto extends createZodDto(z.object({ id: idSchema })) {}

/** The Catalog screen: services and diagnoses of the current tenant (C6). */
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('services')
  @RequirePermission('catalog:read')
  @ZodResponse({ type: [ServiceItemDto] })
  listServices() {
    return this.catalog.listServices();
  }

  @Put('services')
  @RequirePermission('catalog:write')
  @ZodResponse({ type: [ServiceItemDto] })
  saveServices(@Body() body: ServiceBatchDto) {
    return this.catalog.saveServices(body);
  }

  @Delete('services/:id')
  @RequirePermission('catalog:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteService(@Param() params: CatalogParamsDto) {
    return this.catalog.deleteService(params.id);
  }

  @Post('services/:id/deactivate')
  @RequirePermission('catalog:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: ServiceItemDto })
  deactivateService(@Param() params: CatalogParamsDto) {
    return this.catalog.deactivateService(params.id);
  }

  @Get('diagnoses')
  @RequirePermission('catalog:read')
  @ZodResponse({ type: [DiagnosisItemDto] })
  listDiagnoses() {
    return this.catalog.listDiagnoses();
  }

  @Put('diagnoses')
  @RequirePermission('catalog:write')
  @ZodResponse({ type: [DiagnosisItemDto] })
  saveDiagnoses(@Body() body: DiagnosisBatchDto) {
    return this.catalog.saveDiagnoses(body);
  }

  @Delete('diagnoses/:id')
  @RequirePermission('catalog:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDiagnosis(@Param() params: CatalogParamsDto) {
    return this.catalog.deleteDiagnosis(params.id);
  }

  @Post('diagnoses/:id/deactivate')
  @RequirePermission('catalog:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: DiagnosisItemDto })
  deactivateDiagnosis(@Param() params: CatalogParamsDto) {
    return this.catalog.deactivateDiagnosis(params.id);
  }

  /** The admin Overview's "Seed default catalog" (C3); a no-op once the tenant has a catalog. */
  @Post('seed-default')
  @RequirePermission('catalog:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: CatalogSeedResultDto })
  seedDefault() {
    return this.catalog.seedDefaultCatalog();
  }
}
