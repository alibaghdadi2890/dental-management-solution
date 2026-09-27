import {
  idSchema,
  practitionerSchema,
  resetPasswordRequestSchema,
  staffUserCreateSchema,
  staffUserPatchSchema,
  staffUserSchema,
  staffUserStatusChangeSchema,
} from '@dcm/contracts';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { UsersService } from '../application/users.service';

class StaffUserDto extends createZodDto(staffUserSchema) {}
class StaffUserCreateDto extends createZodDto(staffUserCreateSchema) {}
class StaffUserPatchDto extends createZodDto(staffUserPatchSchema) {}
class StaffUserStatusChangeDto extends createZodDto(staffUserStatusChangeSchema) {}
class ResetPasswordDto extends createZodDto(resetPasswordRequestSchema) {}
class PractitionerDto extends createZodDto(practitionerSchema) {}
class UserParamsDto extends createZodDto(z.object({ id: idSchema })) {}

/** Staff users of the current tenant; `:id` is the auth user id (D7). */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('user:read')
  @ZodResponse({ type: [StaffUserDto] })
  list() {
    return this.users.list();
  }

  // Declared before `:id` so `practitioners` isn't captured as a user id.
  @Get('practitioners')
  @RequirePermission('user:read')
  @ZodResponse({ type: [PractitionerDto] })
  practitioners() {
    return this.users.listPractitioners();
  }

  @Get(':id')
  @RequirePermission('user:read')
  @ZodResponse({ type: StaffUserDto })
  get(@Param() params: UserParamsDto) {
    return this.users.get(params.id);
  }

  @Post()
  @RequirePermission('user:write')
  @ZodResponse({ status: 201, type: StaffUserDto })
  create(@Body() body: StaffUserCreateDto) {
    return this.users.createStaffUser(body);
  }

  @Patch(':id')
  @RequirePermission('user:write')
  @ZodResponse({ type: StaffUserDto })
  update(@Param() params: UserParamsDto, @Body() body: StaffUserPatchDto) {
    return this.users.updateStaffUser(params.id, body);
  }

  @Post(':id/deactivate')
  @RequirePermission('user:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: StaffUserDto })
  deactivate(@Param() params: UserParamsDto, @Body() body: StaffUserStatusChangeDto) {
    return this.users.deactivate(params.id, body.reason);
  }

  @Post(':id/reactivate')
  @RequirePermission('user:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: StaffUserDto })
  reactivate(@Param() params: UserParamsDto, @Body() body: StaffUserStatusChangeDto) {
    return this.users.reactivate(params.id, body.reason);
  }

  @Post(':id/reset-password')
  @RequirePermission('user:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Param() params: UserParamsDto, @Body() body: ResetPasswordDto) {
    await this.users.resetPassword(params.id, body.temporaryPassword);
  }
}
