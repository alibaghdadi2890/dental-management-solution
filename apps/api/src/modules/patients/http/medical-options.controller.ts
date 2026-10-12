import {
  idSchema,
  medicalOptionAddSchema,
  medicalOptionBatchSchema,
  medicalOptionSchema,
  medicalOptionSeedResultSchema,
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
import { MedicalOptionsService } from '../application/medical-options.service';

class MedicalOptionDto extends createZodDto(medicalOptionSchema) {}
class MedicalOptionAddDto extends createZodDto(medicalOptionAddSchema) {}
class MedicalOptionBatchDto extends createZodDto(medicalOptionBatchSchema) {}
class MedicalOptionSeedResultDto extends createZodDto(medicalOptionSeedResultSchema) {}
class OptionParamsDto extends createZodDto(z.object({ id: idSchema })) {}

/**
 * A clinic's allergy and condition lists (docs/modules/patients.md, ADR-0046). Read by everyone
 * who reads patients; edited from the Catalog screen, in batches like its other lists. A name
 * typed into a patient's history is added with `POST`.
 */
@Controller('medical-history/options')
export class MedicalOptionsController {
  constructor(private readonly options: MedicalOptionsService) {}

  @Get()
  @RequirePermission('patient:read')
  @ZodResponse({ type: [MedicalOptionDto] })
  list() {
    return this.options.list();
  }

  @Post()
  @RequirePermission('patient:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: MedicalOptionDto })
  add(@Body() body: MedicalOptionAddDto) {
    return this.options.add(body);
  }

  @Put()
  @RequirePermission('catalog:write')
  @ZodResponse({ type: [MedicalOptionDto] })
  save(@Body() body: MedicalOptionBatchDto) {
    return this.options.save(body);
  }

  /** Before `:id`, like the other static paths. A no-op once the tenant has a list. */
  @Post('seed-default')
  @RequirePermission('catalog:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: MedicalOptionSeedResultDto })
  seedDefault() {
    return this.options.seedDefaults();
  }

  @Delete(':id')
  @RequirePermission('catalog:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param() params: OptionParamsDto) {
    return this.options.remove(params.id);
  }

  @Post(':id/deactivate')
  @RequirePermission('catalog:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: MedicalOptionDto })
  deactivate(@Param() params: OptionParamsDto) {
    return this.options.deactivate(params.id);
  }
}
