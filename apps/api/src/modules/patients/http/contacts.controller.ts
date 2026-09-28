import {
  contactLookupItemSchema,
  contactLookupQuerySchema,
  contactPatchSchema,
  contactViewSchema,
  idSchema,
  patientListItemSchema,
} from '@dcm/contracts';
import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { ContactsService } from '../application/contacts.service';

class ContactViewDto extends createZodDto(contactViewSchema) {}
class ContactPatchDto extends createZodDto(contactPatchSchema) {}
class ContactLookupQueryDto extends createZodDto(contactLookupQuerySchema) {}
/** A union has no class form (a class must extend an object type): the DTO is the value itself. */
const ContactLookupItemDto = createZodDto(contactLookupItemSchema);
class PatientListItemDto extends createZodDto(patientListItemSchema) {}
class ContactParamsDto extends createZodDto(z.object({ id: idSchema })) {}

/**
 * The contacts themselves (design addendum C5): the search-or-create lookup, editing an unlinked
 * contact, and the patients a contact is the billing contact of. A patient's links are under
 * `/patients/:id/contacts` (`PatientsController`).
 */
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  // Static paths before `:id`.

  @Get('lookup')
  @RequirePermission('patient:read')
  @ZodResponse({ type: [ContactLookupItemDto] })
  lookup(@Query() query: ContactLookupQueryDto) {
    return this.contacts.lookup(query);
  }

  @Patch(':id')
  @RequirePermission('patient:write')
  @ZodResponse({ type: ContactViewDto })
  update(@Param() params: ContactParamsDto, @Body() body: ContactPatchDto) {
    return this.contacts.updateContact(params.id, body);
  }

  @Get(':id/billed-patients')
  @RequirePermission('patient:read')
  @ZodResponse({ type: [PatientListItemDto] })
  billedPatients(@Param() params: ContactParamsDto) {
    return this.contacts.patientsBilledBy(params.id);
  }
}
