import { roomBatchSchema, roomQuerySchema, roomSchema } from '@dcm/contracts';
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { TenancyService } from '../application/tenancy.service';

class RoomDto extends createZodDto(roomSchema) {}
class RoomQueryDto extends createZodDto(roomQuerySchema) {}
class RoomBatchDto extends createZodDto(roomBatchSchema) {}

@Controller('rooms')
export class RoomsController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get()
  @RequirePermission('tenant:read')
  @ZodResponse({ type: [RoomDto] })
  list(@Query() query: RoomQueryDto) {
    return this.tenancy.listRooms(query.branchId);
  }

  @Post('batch')
  @RequirePermission('tenant:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: [RoomDto] })
  save(@Body() body: RoomBatchDto) {
    return this.tenancy.saveRooms(body);
  }
}
