import {
  duplicateCheckQuerySchema,
  duplicateGroupSchema,
  idSchema,
  patientArchiveSchema,
  patientCountsSchema,
  patientInputSchema,
  patientListItemSchema,
  patientListQuerySchema,
  patientMergeSchema,
  patientPageSchema,
  patientPatchSchema,
  patientRestoreSchema,
  patientSchema,
} from '@dcm/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { PatientsService } from '../application/patients.service';

/**
 * `GET /patients` takes the shared list query minus what needs balances: `view=owing` and
 * `sort=balance` are served by `GET /billing/patients` (design Q5) and answered here with 400.
 */
const patientsRouteQuerySchema = patientListQuerySchema
  .refine((query) => query.view !== 'owing', {
    message: 'The owing view is served by GET /billing/patients',
    path: ['view'],
  })
  .refine((query) => query.sort !== 'balance', {
    message: 'Sorting by balance is served by GET /billing/patients',
    path: ['sort'],
  });

class PatientDto extends createZodDto(patientSchema) {}
class PatientInputDto extends createZodDto(patientInputSchema) {}
class PatientPatchDto extends createZodDto(patientPatchSchema) {}
class PatientListItemDto extends createZodDto(patientListItemSchema) {}
class PatientsQueryDto extends createZodDto(patientsRouteQuerySchema) {}
class PatientPageDto extends createZodDto(patientPageSchema) {}
class PatientCountsDto extends createZodDto(patientCountsSchema) {}
class DuplicateGroupDto extends createZodDto(duplicateGroupSchema) {}
class DuplicateCheckQueryDto extends createZodDto(duplicateCheckQuerySchema) {}
class PatientArchiveDto extends createZodDto(patientArchiveSchema) {}
class PatientRestoreDto extends createZodDto(patientRestoreSchema) {}
class PatientMergeDto extends createZodDto(patientMergeSchema) {}
class PatientParamsDto extends createZodDto(z.object({ id: idSchema })) {}

/** The Patients screen, the ⌘K palette and the patient record (docs/modules/patients.md). */
@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  @RequirePermission('patient:read')
  @ZodResponse({ type: PatientPageDto })
  search(@Query() query: PatientsQueryDto) {
    return this.patients.search(query);
  }

  // Static paths before `:id`.

  @Get('counts')
  @RequirePermission('patient:read')
  @ZodResponse({ type: PatientCountsDto })
  counts() {
    return this.patients.counts();
  }

  @Get('duplicates')
  @RequirePermission('patient:read')
  @ZodResponse({ type: [DuplicateGroupDto] })
  duplicates() {
    return this.patients.duplicates();
  }

  @Get('duplicates/check')
  @RequirePermission('patient:read')
  @ZodResponse({ type: [PatientListItemDto] })
  checkDuplicates(@Query() query: DuplicateCheckQueryDto) {
    return this.patients.checkDuplicates(query);
  }

  @Post('archive')
  @RequirePermission('patient:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: [PatientDto] })
  archive(@Body() body: PatientArchiveDto) {
    return this.patients.archive(body);
  }

  @Post('restore')
  @RequirePermission('patient:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: [PatientDto] })
  restore(@Body() body: PatientRestoreDto) {
    return this.patients.restore(body);
  }

  @Post('merge')
  @RequirePermission('patient:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: PatientDto })
  merge(@Body() body: PatientMergeDto) {
    return this.patients.merge(body);
  }

  @Get(':id')
  @RequirePermission('patient:read')
  @ZodResponse({ type: PatientDto })
  get(@Param() params: PatientParamsDto) {
    return this.patients.get(params.id);
  }

  @Post()
  @RequirePermission('patient:write')
  @ZodResponse({ status: 201, type: PatientDto })
  create(@Body() body: PatientInputDto) {
    return this.patients.create(body);
  }

  @Patch(':id')
  @RequirePermission('patient:write')
  @ZodResponse({ type: PatientDto })
  update(@Param() params: PatientParamsDto, @Body() body: PatientPatchDto) {
    return this.patients.update(params.id, body);
  }
}
