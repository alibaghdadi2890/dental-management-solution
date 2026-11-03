import type { AlertFollowsInput, AlertTray, AlertWaiting } from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { Clock } from '../../../platform/kernel/clock';
import { AuditService } from '../../audit';
import { VisitsService } from '../../clinical';
import { AppointmentsService } from '../../scheduling';
import { UsersService } from '../../users';
import { AlertDentistInvalidError } from '../domain/alerts-errors';
import { AlertFollowsRepository } from '../persistence/alert-follows.repository';

/**
 * "Your patients" (feature 15, docs/modules/alerts.md): the tray is derived from what `scheduling`
 * and `clinical` hold (D5), for the caller's dentists, their own staff profile when they practise
 * and those they follow (D3). Only the follows are stored.
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly follows: AlertFollowsRepository,
    private readonly appointments: AppointmentsService,
    private readonly visits: VisitsService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Who is waiting for the caller's dentists in the session's branch (today's checked-in
   * appointments, with `appointment:read`), and their live visits and those the caller started,
   * within the caller's visit scope.
   * A dentist who left is nobody's: their follows stay, unshown, should they come back.
   */
  tray(): Promise<AlertTray> {
    this.context.requirePermission('visit:write');
    const userId = this.context.requireUserId();
    const branchId = this.context.branchId;
    return this.tenantDb.run(async () => {
      const follows = await this.follows.forUser(userId);
      const active = new Set((await this.users.listPractitioners()).map((item) => item.id));
      const own = this.context.staffProfileId;
      const dentists = new Set(
        [...(own === null ? [] : [own]), ...follows].filter((id) => active.has(id)),
      );
      const waiting: AlertWaiting[] =
        branchId !== undefined &&
        dentists.size > 0 &&
        this.context.hasPermission('appointment:read')
          ? (await this.appointments.todayBoard(branchId)).appointments.flatMap((item) =>
              item.status === 'checked_in' &&
              item.checkedInAt !== null &&
              dentists.has(item.dentistId)
                ? [
                    {
                      appointmentId: item.id,
                      patientId: item.patient.id,
                      patientName: item.patient.fullName,
                      dentistId: item.dentistId,
                      dentistName: item.dentistName,
                      roomName: item.roomName,
                      startsAt: item.startsAt,
                      checkedInAt: item.checkedInAt,
                    },
                  ]
                : [],
            )
          : [];
      return {
        waiting: waiting.sort((a, b) => a.checkedInAt.localeCompare(b.checkedInAt)),
        inRoom: await this.visits.liveOfDentists([...dentists]),
        follows,
        serverNow: this.clock.now().toISOString(),
      };
    });
  }

  /**
   * The dentists the caller follows, as a whole set. Following anyone but oneself needs
   * `visit:read_all` (D3: the visit scope, ADR-0055); each must be an active dentist of the clinic.
   */
  setFollows(input: AlertFollowsInput): Promise<string[]> {
    this.context.requirePermission('visit:write');
    const userId = this.context.requireUserId();
    const own = this.context.staffProfileId;
    if (input.dentistIds.some((id) => id !== own)) {
      this.context.requirePermission('visit:read_all');
    }
    return this.tenantDb.run(async () => {
      const active = new Set((await this.users.listPractitioners()).map((item) => item.id));
      const invalid = input.dentistIds.filter((id) => !active.has(id));
      if (invalid.length > 0) throw new AlertDentistInvalidError(invalid);
      const before = await this.follows.forUser(userId);
      await this.follows.replace(userId, input.dentistIds);
      await this.audit.record({
        action: 'alerts.follows',
        resourceType: 'alert_follows',
        resourceId: userId,
        before: { dentistIds: before },
        after: { dentistIds: input.dentistIds },
      });
      return input.dentistIds;
    });
  }
}
