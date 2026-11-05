import {
  appointmentCheckResultSchema,
  appointmentCheckSchema,
  appointmentRangeQuerySchema,
  appointmentSchema,
  bookAppointmentSchema,
  cancelAppointmentSchema,
  changeAppointmentRoomSchema,
  checkInAppointmentSchema,
  declineFollowUpSchema,
  editAppointmentSchema,
  followUpListQuerySchema,
  followUpSchema,
  idSchema,
  openingHoursSchema,
  rescheduleAppointmentSchema,
  resizeAppointmentSchema,
  restoreAppointmentSchema,
  scheduleBranchQuerySchema,
  scheduleResourcesSchema,
  schedulingSettingsSchema,
  slotDaysSchema,
  slotQuerySchema,
  todayBoardSchema,
} from '@dcm/contracts';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
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
import { AppointmentsService } from '../application/appointments.service';
import { FollowUpsService } from '../application/follow-ups.service';
import { OpeningHoursService } from '../application/opening-hours.service';

class AppointmentDto extends createZodDto(appointmentSchema) {}
class AppointmentListDto extends createZodDto(z.array(appointmentSchema)) {}
class RangeQueryDto extends createZodDto(appointmentRangeQuerySchema) {}
class BookDto extends createZodDto(bookAppointmentSchema) {}
class RescheduleDto extends createZodDto(rescheduleAppointmentSchema) {}
class ResizeDto extends createZodDto(resizeAppointmentSchema) {}
class CancelDto extends createZodDto(cancelAppointmentSchema) {}
class RestoreDto extends createZodDto(restoreAppointmentSchema) {}
class EditDto extends createZodDto(editAppointmentSchema) {}
class CheckInDto extends createZodDto(checkInAppointmentSchema) {}
class ChangeRoomDto extends createZodDto(changeAppointmentRoomSchema) {}
class CheckDto extends createZodDto(appointmentCheckSchema) {}
class CheckResultDto extends createZodDto(appointmentCheckResultSchema) {}
class SlotQueryDto extends createZodDto(slotQuerySchema) {}
class SlotDaysDto extends createZodDto(slotDaysSchema) {}
class ResourcesDto extends createZodDto(scheduleResourcesSchema) {}
class BranchQueryDto extends createZodDto(scheduleBranchQuerySchema) {}
class TodayDto extends createZodDto(todayBoardSchema) {}
class FollowUpDto extends createZodDto(followUpSchema) {}
class FollowUpListDto extends createZodDto(z.array(followUpSchema)) {}
class FollowUpQueryDto extends createZodDto(followUpListQuerySchema) {}
class DeclineDto extends createZodDto(declineFollowUpSchema) {}
class OpeningHoursDto extends createZodDto(openingHoursSchema) {}
class SettingsDto extends createZodDto(schedulingSettingsSchema) {}
class IdParamsDto extends createZodDto(z.object({ id: idSchema })) {}

/**
 * The calendar, bookings, follow-ups and opening hours (feature 14, docs/modules/scheduling.md). The
 * routes check `appointment:write`; whose column it is, is the service's (`canWriteAppointment`).
 */
@Controller('scheduling')
export class SchedulingController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly followUps: FollowUpsService,
    private readonly openingHours: OpeningHoursService,
  ) {}

  @Get('appointments')
  @RequirePermission('appointment:read')
  @ZodResponse({ type: AppointmentListDto })
  range(@Query() query: RangeQueryDto) {
    return this.appointments.range(query);
  }

  @Post('appointments')
  @RequirePermission('appointment:write')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ type: AppointmentDto, status: 201 })
  book(@Body() body: BookDto, @Headers('idempotency-key') key: string | undefined) {
    return this.appointments.book(body, idempotencyKey(key));
  }

  /** The dry run: `appointment:read`, as it changes nothing. */
  @Post('appointments/check')
  @RequirePermission('appointment:read')
  @HttpCode(200)
  @ZodResponse({ type: CheckResultDto })
  check(@Body() body: CheckDto) {
    return this.appointments.check(body);
  }

  @Get('appointments/:id')
  @RequirePermission('appointment:read')
  @ZodResponse({ type: AppointmentDto })
  get(@Param() params: IdParamsDto) {
    return this.appointments.get(params.id);
  }

  /** The Edit appointment panel (ADR-0075): a move makes a new row, hence the key. */
  @Patch('appointments/:id')
  @RequirePermission('appointment:write')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ type: AppointmentDto })
  edit(
    @Param() params: IdParamsDto,
    @Body() body: EditDto,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.appointments.edit(params.id, body, idempotencyKey(key));
  }

  @Post('appointments/:id/reschedule')
  @RequirePermission('appointment:write')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ type: AppointmentDto })
  reschedule(
    @Param() params: IdParamsDto,
    @Body() body: RescheduleDto,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.appointments.reschedule(params.id, body, idempotencyKey(key));
  }

  @Post('appointments/:id/resize')
  @RequirePermission('appointment:write')
  @HttpCode(200)
  @ZodResponse({ type: AppointmentDto })
  resize(@Param() params: IdParamsDto, @Body() body: ResizeDto) {
    return this.appointments.resize(params.id, body);
  }

  @Post('appointments/:id/confirm')
  @RequirePermission('appointment:write')
  @HttpCode(200)
  @ZodResponse({ type: AppointmentDto })
  confirm(@Param() params: IdParamsDto) {
    return this.appointments.confirm(params.id);
  }

  @Post('appointments/:id/check-in')
  @RequirePermission('appointment:write')
  @HttpCode(200)
  @ZodResponse({ type: AppointmentDto })
  checkIn(@Param() params: IdParamsDto, @Body() body: CheckInDto) {
    return this.appointments.checkIn(params.id, body);
  }

  @Post('appointments/:id/undo-check-in')
  @RequirePermission('appointment:write')
  @HttpCode(200)
  @ZodResponse({ type: AppointmentDto })
  undoCheckIn(@Param() params: IdParamsDto) {
    return this.appointments.undoCheckIn(params.id);
  }

  @Post('appointments/:id/room')
  @RequirePermission('appointment:write')
  @HttpCode(200)
  @ZodResponse({ type: AppointmentDto })
  changeRoom(@Param() params: IdParamsDto, @Body() body: ChangeRoomDto) {
    return this.appointments.changeRoom(params.id, body);
  }

  @Post('appointments/:id/cancel')
  @RequirePermission('appointment:write')
  @HttpCode(200)
  @ZodResponse({ type: AppointmentDto })
  cancel(@Param() params: IdParamsDto, @Body() body: CancelDto) {
    return this.appointments.cancel(params.id, body);
  }

  @Post('appointments/:id/restore')
  @RequirePermission('appointment:write')
  @HttpCode(200)
  @ZodResponse({ type: AppointmentDto })
  restore(@Param() params: IdParamsDto, @Body() body: RestoreDto) {
    return this.appointments.restore(params.id, body);
  }

  @Post('appointments/:id/no-show')
  @RequirePermission('appointment:write')
  @HttpCode(200)
  @ZodResponse({ type: AppointmentDto })
  noShow(@Param() params: IdParamsDto) {
    return this.appointments.markNoShow(params.id);
  }

  @Get('slots')
  @RequirePermission('appointment:read')
  @ZodResponse({ type: SlotDaysDto })
  slots(@Query() query: SlotQueryDto) {
    return this.appointments.slots(query);
  }

  /** The calendar's columns and the room pickers. */
  @Get('resources')
  @RequirePermission('appointment:read')
  @ZodResponse({ type: ResourcesDto })
  resources(@Query() query: BranchQueryDto) {
    return this.appointments.resources(query.branchId);
  }

  @Get('today')
  @RequirePermission('appointment:read')
  @ZodResponse({ type: TodayDto })
  today(@Query() query: BranchQueryDto) {
    return this.appointments.todayBoard(query.branchId);
  }

  @Get('patients/:id/appointments')
  @RequirePermission('appointment:read')
  @ZodResponse({ type: AppointmentListDto })
  patientAppointments(@Param() params: IdParamsDto) {
    return this.appointments.forPatient(params.id);
  }

  @Get('patients/:id/follow-ups')
  @RequirePermission('appointment:read')
  @ZodResponse({ type: FollowUpListDto })
  patientFollowUps(@Param() params: IdParamsDto) {
    return this.followUps.forPatient(params.id);
  }

  @Get('follow-ups')
  @RequirePermission('appointment:write_all')
  @ZodResponse({ type: FollowUpListDto })
  worklist(@Query() query: FollowUpQueryDto) {
    return this.followUps.worklist(query);
  }

  @Post('follow-ups/:id/will-call')
  @RequirePermission('appointment:write_all')
  @HttpCode(200)
  @ZodResponse({ type: FollowUpDto })
  willCall(@Param() params: IdParamsDto) {
    return this.followUps.markWillCall(params.id);
  }

  @Post('follow-ups/:id/decline')
  @RequirePermission('appointment:write_all')
  @HttpCode(200)
  @ZodResponse({ type: FollowUpDto })
  decline(@Param() params: IdParamsDto, @Body() body: DeclineDto) {
    return this.followUps.decline(params.id, body);
  }

  @Get('branches/:id/opening-hours')
  @RequirePermission('appointment:read')
  @ZodResponse({ type: OpeningHoursDto })
  hours(@Param() params: IdParamsDto) {
    return this.openingHours.get(params.id);
  }

  @Put('branches/:id/opening-hours')
  @RequirePermission('tenant:write')
  @ZodResponse({ type: OpeningHoursDto })
  saveHours(@Param() params: IdParamsDto, @Body() body: OpeningHoursDto) {
    return this.openingHours.save(params.id, body);
  }

  @Get('settings')
  @RequirePermission('appointment:read')
  @ZodResponse({ type: SettingsDto })
  settings() {
    return this.openingHours.getSettings();
  }

  @Put('settings')
  @RequirePermission('tenant:write')
  @ZodResponse({ type: SettingsDto })
  saveSettings(@Body() body: SettingsDto) {
    return this.openingHours.saveSettings(body);
  }
}
