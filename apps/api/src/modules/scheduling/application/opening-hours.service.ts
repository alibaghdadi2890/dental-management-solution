import type { OpeningDay, OpeningHours, SchedulingSettings } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import { AuditService } from '../../audit';
import { BranchNotFoundError, TenancyService } from '../../tenancy';
import { OPENING_HOURS_CHANGED, type OpeningHoursChanged } from '../events/scheduling-events';
import { OpeningHoursRepository } from '../persistence/opening-hours.repository';

/** A branch's weekly hours and the clinic's follow-up window (ADR-0068, A19). */
@Injectable()
export class OpeningHoursService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly tenancy: TenancyService,
    private readonly hours: OpeningHoursRepository,
  ) {}

  get(branchId: string): Promise<OpeningHours> {
    this.context.requirePermission('appointment:read');
    return this.tenantDb.run(async () => {
      await this.assertBranch(branchId);
      return { days: await this.hours.forBranch(branchId) };
    });
  }

  /** Never touches an appointment: the calendar shows those outside the hours as warnings. */
  save(branchId: string, input: OpeningHours): Promise<OpeningHours> {
    this.context.requirePermission('tenant:write');
    return this.tenantDb.run(async () => {
      await this.assertBranch(branchId);
      const before = await this.hours.forBranch(branchId);
      await this.hours.save(branchId, input.days);
      const days: OpeningDay[] = await this.hours.forBranch(branchId);
      await this.audit.record({
        action: 'opening_hours.update',
        resourceType: 'branch',
        resourceId: branchId,
        before: { days: before },
        after: { days },
      });
      const event: OpeningHoursChanged = this.events.create(OPENING_HOURS_CHANGED, { branchId });
      await this.events.publish(event);
      return { days };
    });
  }

  /** `BranchCreated`, in its transaction (G1). */
  seedBranch(branchId: string): Promise<void> {
    return this.hours.seed(branchId);
  }

  getSettings(): Promise<SchedulingSettings> {
    this.context.requirePermission('appointment:read');
    return this.tenantDb.run(async () => ({ followUpWindowDays: await this.hours.windowDays() }));
  }

  saveSettings(input: SchedulingSettings): Promise<SchedulingSettings> {
    this.context.requirePermission('tenant:write');
    return this.tenantDb.run(async () => {
      const before = await this.hours.windowDays();
      if (before === input.followUpWindowDays) return input;
      await this.hours.saveWindowDays(input.followUpWindowDays);
      await this.audit.record({
        action: 'scheduling_settings.update',
        resourceType: 'tenant',
        resourceId: this.context.requireTenantId(),
        before: { followUpWindowDays: before },
        after: { followUpWindowDays: input.followUpWindowDays },
      });
      return input;
    });
  }

  private async assertBranch(branchId: string): Promise<void> {
    if ((await this.tenancy.branchesByIds([branchId])).length === 0) {
      throw new BranchNotFoundError('Branch not found');
    }
  }
}
