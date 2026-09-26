import { branchCreateSchema, branchPatchSchema, branchSchema, idSchema } from '@dcm/contracts';
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { TenancyService } from '../application/tenancy.service';

class BranchDto extends createZodDto(branchSchema) {}
class BranchCreateDto extends createZodDto(branchCreateSchema) {}
class BranchPatchDto extends createZodDto(branchPatchSchema) {}
class BranchParamsDto extends createZodDto(z.object({ id: idSchema })) {}

@Controller('branches')
export class BranchesController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get()
  @RequirePermission('tenant:read')
  @ZodResponse({ type: [BranchDto] })
  list() {
    return this.tenancy.listBranches();
  }

  @Post()
  @RequirePermission('tenant:write')
  @ZodResponse({ status: 201, type: BranchDto })
  create(@Body() body: BranchCreateDto) {
    return this.tenancy.createBranch(body);
  }

  @Patch(':id')
  @RequirePermission('tenant:write')
  @ZodResponse({ type: BranchDto })
  update(@Param() params: BranchParamsDto, @Body() body: BranchPatchDto) {
    return this.tenancy.updateBranch(params.id, body);
  }
}
