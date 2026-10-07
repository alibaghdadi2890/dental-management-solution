import {
  contactLinkInputSchema,
  contactLinkPatchSchema,
  dentitionOverrideSchema,
  duplicateCheckQuerySchema,
  duplicateGroupSchema,
  idSchema,
  patientArchiveSchema,
  patientContactSchema,
  patientCountsSchema,
  patientCreateSchema,
  patientListItemSchema,
  patientListQuerySchema,
  patientMergeSchema,
  patientNameSchema,
  patientNamesQuerySchema,
  patientPageSchema,
  patientPatchSchema,
  patientRestoreSchema,
  patientSchema,
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
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { idempotencyKey } from '../../../platform/http/idempotency-key';
import { RequirePermission } from '../../../platform/http/route-access';
import { ContactsService } from '../application/contacts.service';
import { PatientsService } from '../application/patients.service';

/**
 * `GET /patients` takes the shared list query minus what needs another module's data:
 * `view=owing`, `sort=balance`, `view=notSeen` and `lastVisit=never` are served by
 * `GET /billing/patients` (design Q5, feature 4b) and answered here with 400.
 */
const patientsRouteQuerySchema = patientListQuerySchema
  .refine((query) => query.view !== 'owing', {
    message: 'The owing view is served by GET /billing/patients',
    path: ['view'],
  })
  .refine((query) => query.sort !== 'balance', {
    message: 'Sorting by balance is served by GET /billing/patients',
    path: ['sort'],
  })
  .refine((query) => query.view !== 'notSeen', {
    message: 'The not-seen view is served by GET /billing/patients',
    path: ['view'],
  })
  .refine((query) => query.lastVisit !== 'never', {
    message: 'The never-seen filter is served by GET /billing/patients',
    path: ['lastVisit'],
  });

class PatientDto extends createZodDto(patientSchema) {}
class PatientCreateDto extends createZodDto(patientCreateSchema) {}
class PatientPatchDto extends createZodDto(patientPatchSchema) {}
class DentitionOverrideDto extends createZodDto(dentitionOverrideSchema) {}
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
class PatientContactParamsDto extends createZodDto(
  z.object({ id: idSchema, contactId: idSchema }),
) {}
class PatientNamesQueryDto extends createZodDto(patientNamesQuerySchema) {}
class PatientNameDto extends createZodDto(patientNameSchema) {}
class PatientContactDto extends createZodDto(patientContactSchema) {}
class ContactLinkInputDto extends createZodDto(contactLinkInputSchema) {}
class ContactLinkPatchDto extends createZodDto(contactLinkPatchSchema) {}

/**
 * The Patients screen, the ⌘K palette and the patient record (docs/modules/patients.md), with the
 * record's contacts (addendum C5): each contact write returns the patient's contacts after it.
 */
@Controller('patients')
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly contacts: ContactsService,
  ) {}

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

  /** Before `:id`, like the other static paths. */
  @Get('names')
  @RequirePermission('patient:read')
  @ZodResponse({ type: [PatientNameDto] })
  names(@Query() query: PatientNamesQueryDto) {
    return this.patients.names(query.ids);
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

  /** A retry with the same `Idempotency-Key` and body answers with the first patient (H5). */
  @Post()
  @RequirePermission('patient:write')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 201, type: PatientDto })
  create(@Body() body: PatientCreateDto, @Headers('idempotency-key') key: string | undefined) {
    return this.patients.create(body, { idempotencyKey: idempotencyKey(key) });
  }

  @Patch(':id')
  @RequirePermission('patient:write')
  @ZodResponse({ type: PatientDto })
  update(@Param() params: PatientParamsDto, @Body() body: PatientPatchDto) {
    return this.patients.update(params.id, body);
  }

  /** Set from the workspace's chart card header only (spec W14): `visit:write`, not `patient:write`. */
  @Put(':id/dentition')
  @RequirePermission('visit:write')
  @ZodResponse({ type: PatientDto })
  setDentition(@Param() params: PatientParamsDto, @Body() body: DentitionOverrideDto) {
    return this.patients.setDentition(params.id, body);
  }

  @Get(':id/contacts')
  @RequirePermission('patient:read')
  @ZodResponse({ type: [PatientContactDto] })
  contactsOf(@Param() params: PatientParamsDto) {
    return this.contacts.contactsOf(params.id);
  }

  @Post(':id/contacts')
  @RequirePermission('patient:write')
  @ZodResponse({ status: 201, type: [PatientContactDto] })
  link(@Param() params: PatientParamsDto, @Body() body: ContactLinkInputDto) {
    return this.contacts.link(params.id, body);
  }

  @Patch(':id/contacts/:contactId')
  @RequirePermission('patient:write')
  @ZodResponse({ type: [PatientContactDto] })
  updateLink(@Param() params: PatientContactParamsDto, @Body() body: ContactLinkPatchDto) {
    return this.contacts.updateLink(params.id, params.contactId, body);
  }

  @Delete(':id/contacts/:contactId')
  @RequirePermission('patient:write')
  @ZodResponse({ type: [PatientContactDto] })
  unlink(@Param() params: PatientContactParamsDto) {
    return this.contacts.unlink(params.id, params.contactId);
  }
}
