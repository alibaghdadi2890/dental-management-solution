import { roleSchema } from '@dcm/contracts';
import { Controller, Get } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { RolesService } from '../application/roles.service';

class RoleDto extends createZodDto(roleSchema) {}

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission('role:read')
  @ZodResponse({ type: [RoleDto] })
  list() {
    return this.roles.listRoles();
  }
}
