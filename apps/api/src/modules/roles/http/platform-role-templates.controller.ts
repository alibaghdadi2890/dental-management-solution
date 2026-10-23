import { idSchema, roleCreateSchema, roleTemplateSchema, roleUpdateSchema } from '@dcm/contracts';
import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { RoleTemplatesService } from '../application/role-templates.service';

class RoleTemplateDto extends createZodDto(roleTemplateSchema) {}
class RoleCreateDto extends createZodDto(roleCreateSchema) {}
class RoleUpdateDto extends createZodDto(roleUpdateSchema) {}
class TemplateParamsDto extends createZodDto(z.object({ id: idSchema })) {}

/** The platform's default roles (ADR-0056): what new clinics are created with. Platform only. */
@Controller('platform/role-templates')
export class PlatformRoleTemplatesController {
  constructor(private readonly templates: RoleTemplatesService) {}

  @Get()
  @RequirePermission('platform:admin')
  @ZodResponse({ type: [RoleTemplateDto] })
  list() {
    return this.templates.list();
  }

  @Post()
  @RequirePermission('platform:admin')
  @ZodResponse({ status: 201, type: RoleTemplateDto })
  create(@Body() body: RoleCreateDto) {
    return this.templates.create(body);
  }

  @Patch(':id')
  @RequirePermission('platform:admin')
  @ZodResponse({ type: RoleTemplateDto })
  update(@Param() params: TemplateParamsDto, @Body() body: RoleUpdateDto) {
    return this.templates.update(params.id, body);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('platform:admin')
  @ZodResponse({ type: RoleTemplateDto })
  deactivate(@Param() params: TemplateParamsDto) {
    return this.templates.setActive(params.id, false);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermission('platform:admin')
  @ZodResponse({ type: RoleTemplateDto })
  reactivate(@Param() params: TemplateParamsDto) {
    return this.templates.setActive(params.id, true);
  }
}
