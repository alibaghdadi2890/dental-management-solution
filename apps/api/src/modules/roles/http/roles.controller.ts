import { idSchema, roleCreateSchema, roleSchema, roleUpdateSchema } from '@dcm/contracts';
import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { RolesService } from '../application/roles.service';

class RoleDto extends createZodDto(roleSchema) {}
class RoleCreateDto extends createZodDto(roleCreateSchema) {}
class RoleUpdateDto extends createZodDto(roleUpdateSchema) {}
class RoleParamsDto extends createZodDto(z.object({ id: idSchema })) {}

/** The clinic's roles (ADR-0055): system roles but `owner` are editable, custom ones are added
 * and switched off, never deleted. `role:write` is re-checked by the service with its rules. */
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission('role:read')
  @ZodResponse({ type: [RoleDto] })
  list() {
    return this.roles.listRoles();
  }

  @Post()
  @RequirePermission('role:write')
  @ZodResponse({ status: 201, type: RoleDto })
  create(@Body() body: RoleCreateDto) {
    return this.roles.createRole(body);
  }

  @Patch(':id')
  @RequirePermission('role:write')
  @ZodResponse({ type: RoleDto })
  update(@Param() params: RoleParamsDto, @Body() body: RoleUpdateDto) {
    return this.roles.updateRole(params.id, body);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('role:write')
  @ZodResponse({ type: RoleDto })
  deactivate(@Param() params: RoleParamsDto) {
    return this.roles.deactivateRole(params.id);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermission('role:write')
  @ZodResponse({ type: RoleDto })
  reactivate(@Param() params: RoleParamsDto) {
    return this.roles.reactivateRole(params.id);
  }

  @Post(':id/reset')
  @HttpCode(200)
  @RequirePermission('role:write')
  @ZodResponse({ type: RoleDto })
  reset(@Param() params: RoleParamsDto) {
    return this.roles.resetToDefault(params.id);
  }
}
