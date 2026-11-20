import {
  appointmentListPageSchema,
  appointmentListQuerySchema,
  patientListQuerySchema,
  patientPageSchema,
  appointmentCheckResultSchema,
  appointmentCheckSchema,
  appointmentRangeQuerySchema,
  appointmentSchema,
  upcomingAppointmentSchema,
  upcomingQuerySchema,
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
  addWaitlistEntrySchema,
  fillWaitlistEntrySchema,
  leaveOpeningOpenSchema,
  removeWaitlistEntrySchema,
  updateWaitlistEntrySchema,
  waitlistAttemptSchema,
  waitlistEntrySchema,
  waitlistOpeningDetailSchema,
  waitlistOpeningQuerySchema,
  leaveOpeningResultSchema,
  waitlistOpeningsSchema,
  waitlistPageSchema,
  waitlistQuerySchema,
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
import { SchedulingSummaryService } from '../application/scheduling-summary.service';
import { WaitlistOpeningsService } from '../application/waitlist-openings.service';
import { WaitlistService } from '../application/waitlist.service';

class AppointmentDto extends createZodDto(appointmentSchema) {}
class AppointmentListQueryDto extends createZodDto(appointmentListQuerySchema) {}
class AppointmentListPageDto extends createZodDto(appointmentListPageSchema) {}
class PatientListQueryDto extends createZodDto(patientListQuerySchema) {}
class PatientPageDto extends createZodDto(patientPageSchema) {}
class AppointmentListDto extends createZodDto(z.array(appointmentSchema)) {}
class UpcomingAppointmentDto extends createZodDto(upcomingAppointmentSchema) {}
class UpcomingQueryDto extends createZodDto(upcomingQuerySchema) {}
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
class AppointmentIdParamsDto extends createZodDto(z.object({ appointmentId: idSchema })) {}
class WaitlistEntryDto extends createZodDto(waitlistEntrySchema) {}
class WaitlistEntryListDto extends createZodDto(z.array(waitlistEntrySchema)) {}
class WaitlistQueryDto extends createZodDto(waitlistQuerySchema) {}
class WaitlistPageDto extends createZodDto(waitlistPageSchema) {}
class WaitlistOpeningsDto extends createZodDto(waitlistOpeningsSchema) {}
class LeaveOpenResultDto extends createZodDto(leaveOpeningResultSchema) {}
class WaitlistOpeningDetailDto extends createZodDto(waitlistOpeningDetailSchema) {}
class WaitlistOpeningQueryDto extends createZodDto(waitlistOpeningQuerySchema) {}
class LeaveOpenDto extends createZodDto(leaveOpeningOpenSchema) {}
class AddWaitlistDto extends createZodDto(addWaitlistEntrySchema) {}
class UpdateWaitlistDto extends createZodDto(updateWaitlistEntrySchema) {}
class RemoveWaitlistDto extends createZodDto(removeWaitlistEntrySchema) {}
class AttemptDto extends createZodDto(waitlistAttemptSchema) {}
class FillDto extends createZodDto(fillWaitlistEntrySchema) {}

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
    private readonly summary: SchedulingSummaryService,
    private readonly waitlist: WaitlistService,
    private readonly openings: WaitlistOpeningsService,
  ) {}

  /** The Schedule's List view (feature 19): a dashboard figure's appointments. */
  @Get('appointments/list')
  @RequirePermission('appointment:read')
  @ZodResponse({ type: AppointmentListPageDto })
  list(@Query() query: AppointmentListQueryDto) {
    return this.summary.list(query);
  }

  /** Patients with an accepted plan item and nothing booked (feature 19's cohort). */
  @Get('patients')
  @RequirePermission('patient:read')
  @ZodResponse({ type: PatientPageDto })
  patients(@Query() query: PatientListQueryDto) {
    return this.summary.acceptedUnbooked(query);
  }

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

  /** The search's next appointments (search S9). Before `patients/:id/…`; its own depth anyway. */
  @Get('patients/upcoming')
  @RequirePermission('appointment:read')
  @ZodResponse({ type: [UpcomingAppointmentDto] })
  upcoming(@Query() query: UpcomingQueryDto) {
    return this.appointments.nextFor(query.patientIds);
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

  // --- The waitlist (feature 21, docs/modules/scheduling.md) ---

  @Get('waitlist')
  @RequirePermission('appointment:write_all')
  @ZodResponse({ type: WaitlistPageDto })
  waitlistList(@Query() query: WaitlistQueryDto) {
    return this.openings.list(query);
  }

  @Get('waitlist/openings')
  @RequirePermission('appointment:write_all')
  @ZodResponse({ type: WaitlistOpeningsDto })
  waitlistOpenings(@Query() query: BranchQueryDto) {
    return this.openings.openings(query.branchId);
  }

  @Get('waitlist/openings/:appointmentId')
  @RequirePermission('appointment:write_all')
  @ZodResponse({ type: WaitlistOpeningDetailDto })
  waitlistOpening(
    @Param() params: AppointmentIdParamsDto,
    @Query() query: WaitlistOpeningQueryDto,
  ) {
    return this.openings.opening(params.appointmentId, query.at);
  }

  @Post('waitlist/openings/:appointmentId/leave-open')
  @RequirePermission('appointment:write_all')
  @HttpCode(200)
  @ZodResponse({ type: LeaveOpenResultDto })
  leaveOpen(@Param() params: AppointmentIdParamsDto, @Body() body: LeaveOpenDto) {
    return this.openings.leaveOpen(params.appointmentId, body.at);
  }

  @Get('patients/:id/waitlist')
  @RequirePermission('appointment:read')
  @ZodResponse({ type: WaitlistEntryListDto })
  patientWaitlist(@Param() params: IdParamsDto) {
    return this.waitlist.forPatient(params.id);
  }

  /** Without an appointment; the column is the service's (an entry names its dentist). */
  @Post('waitlist')
  @RequirePermission('appointment:write')
  @ZodResponse({ type: WaitlistEntryDto, status: 201 })
  addToWaitlist(@Body() body: AddWaitlistDto) {
    return this.waitlist.add(body);
  }

  @Patch('waitlist/:id')
  @RequirePermission('appointment:write')
  @ZodResponse({ type: WaitlistEntryDto })
  updateWaitlist(@Param() params: IdParamsDto, @Body() body: UpdateWaitlistDto) {
    return this.waitlist.update(params.id, body);
  }

  @Post('waitlist/:id/remove')
  @RequirePermission('appointment:write')
  @HttpCode(200)
  @ZodResponse({ type: WaitlistEntryDto })
  removeFromWaitlist(@Param() params: IdParamsDto, @Body() body: RemoveWaitlistDto) {
    return this.waitlist.remove(params.id, body);
  }

  @Post('waitlist/:id/attempt')
  @RequirePermission('appointment:write_all')
  @HttpCode(200)
  @ZodResponse({ type: WaitlistEntryDto })
  attempt(@Param() params: IdParamsDto, @Body() body: AttemptDto) {
    return this.waitlist.attempt(params.id, body);
  }

  /** The existing booking or move into an opening (ADR-0106): retried safely with the key. */
  @Post('waitlist/:id/fill')
  @RequirePermission('appointment:write_all')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ type: AppointmentDto })
  fill(
    @Param() params: IdParamsDto,
    @Body() body: FillDto,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.openings.fill(params.id, body, idempotencyKey(key));
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
