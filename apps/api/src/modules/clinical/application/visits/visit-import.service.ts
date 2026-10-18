import { fromCents, type ImportVisitLine, type ServiceItem, toCents } from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../../platform/clock/clock.module';
import { RequestContext } from '../../../../platform/cls/request-context';
import { TenantDb } from '../../../../platform/db/tenant-db';
import type { Clock } from '../../../../platform/kernel/clock';
import { localDate, zonedInstant } from '../../../../platform/kernel/local-date';
import {
  type ValidationIssue,
  ValidationFailedError,
} from '../../../../platform/kernel/validation-failed.error';
import { AuditService } from '../../../audit';
import { PatientsService } from '../../../patients';
import { TenancyService } from '../../../tenancy';
import { UsersService } from '../../../users';
import { DentistInvalidError, RoomInvalidError } from '../../domain/visit-errors';
import { PlanSessionsRepository } from '../../persistence/plan-sessions.repository';
import { ProceduresRepository } from '../../persistence/procedures.repository';
import { TreatmentPlansRepository } from '../../persistence/treatment-plans.repository';
import { VisitCountersRepository } from '../../persistence/visit-counters.repository';
import { VisitServicesRepository } from '../../persistence/visit-services.repository';
import { type StoredVisit, VisitsRepository } from '../../persistence/visits.repository';
import { PresenceWriter } from '../records/presence-writer';

/** A visit from a previous system, its patient resolved (feature 6, ADR-0053). */
export interface VisitImport {
  externalId: string;
  patientId: string;
  branchId: string;
  dentistId: string;
  roomId: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  lines: readonly ImportVisitLine[];
}

export interface VisitImportResult {
  visitId: string;
  /** False when a visit with this external id was already imported: nothing was written. */
  created: boolean;
}

/** A line resolved against the catalog, its target checked against the service's unit. */
interface ResolvedLine {
  line: ImportVisitLine;
  service: ServiceItem;
}

const MINUTE = 60_000;

/**
 * Writes a visit from a previous system (feature 6, ADR-0053) in one go: completed on its own
 * day and times, marked imported, with the services it performed as visit services (each at the
 * amount charged, as recorded) and their chart effects (an extraction takes the tooth out, an
 * implant puts one in). A line not done becomes plan work in progress, started in this visit,
 * priced 0: it was charged before, and finishing it here must not charge it again. It publishes
 * no `VisitCompleted`, so `billing` posts nothing: the opening balance already holds the money.
 * Idempotent by `externalId`. Runs in the caller's transaction (`TenantDb` joins it).
 */
@Injectable()
export class VisitImportService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
    private readonly patients: PatientsService,
    private readonly users: UsersService,
    private readonly visits: VisitsRepository,
    private readonly services: VisitServicesRepository,
    private readonly counters: VisitCountersRepository,
    private readonly procedures: ProceduresRepository,
    private readonly plans: TreatmentPlansRepository,
    private readonly sessions: PlanSessionsRepository,
    private readonly presence: PresenceWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async importVisit(input: VisitImport): Promise<VisitImportResult> {
    this.context.requirePermission('visit:write');
    return this.tenantDb.run(async () => {
      const existing = (await this.visits.findIdsByExternalIds([input.externalId])).get(
        input.externalId,
      );
      if (existing) return { visitId: existing, created: false };

      // Archived patients included: their past visits are part of their record.
      const patient = await this.patients.lockForDependentWrite(input.patientId);
      const tenant = await this.tenancy.currentTenant();
      const now = this.clock.now();
      if (input.date > localDate(now, tenant.timeZone)) {
        throw invalid([
          { path: 'date', code: 'future_date', message: 'The visit is in the future' },
        ]);
      }
      this.assertTimes(input);
      await this.assertDentist(input.dentistId);
      await this.assertRoom(input.branchId, input.roomId);
      const lines = await this.resolve(input.lines);

      const userId = this.context.requireUserId();
      const startedAt = zonedInstant(input.date, input.startTime ?? '00:00', tenant.timeZone);
      const ended =
        input.endTime === null ? null : zonedInstant(input.date, input.endTime, tenant.timeZone);
      const minutes =
        ended === null
          ? 1
          : Math.max(1, Math.round((ended.getTime() - startedAt.getTime()) / MINUTE));
      const done = lines.filter(({ line }) => line.done);
      const subtotal = fromCents(done.reduce((sum, { line }) => sum + toCents(line.amount), 0n));
      const visit = await this.visits.insertImported({
        displayNumber: await this.counters.nextValue(),
        patientId: patient.id,
        branchId: input.branchId,
        roomId: input.roomId,
        dentistId: input.dentistId,
        startedBy: userId,
        type: 'treatment',
        currentStep: 'complete',
        reason: null,
        localDate: input.date,
        startedAt,
        currency: tenant.currency,
        status: 'completed',
        notes: input.notes ?? '',
        completedAt: new Date(startedAt.getTime() + minutes * MINUTE),
        completedBy: userId,
        durationMinutes: minutes,
        subtotal,
        discountAmount: '0',
        total: subtotal,
        importedAt: now,
        externalId: input.externalId,
      });

      await this.audit.about({ patientId: visit.patientId, visitId: visit.id }, async () => {
        await this.audit.record({
          action: 'visit.import',
          resourceType: 'visit',
          resourceId: visit.id,
          after: { ...visit, lines: input.lines },
        });
        for (const resolved of lines) {
          if (resolved.line.done) await this.perform(visit, resolved, userId);
          else await this.startPlan(visit, resolved, userId, tenant.currency);
        }
      });
      return { visitId: visit.id, created: true };
    });
  }

  /** A done line: the service performed in the visit, with its effect on the chart. */
  private async perform(visit: StoredVisit, { line, service }: ResolvedLine, userId: string) {
    const stored = await this.services.insert({
      visitId: visit.id,
      procedureId: service.id,
      code: service.code,
      name: service.name,
      category: service.category,
      chargeUnit: service.chargeUnit,
      toothCode: line.tooth,
      jaw: line.jaw,
      surfaces: [],
      baseAmount: line.amount,
      planId: null,
      recordedBy: userId,
    });
    await this.presence.applyService(
      {
        patientId: visit.patientId,
        visitId: visit.id,
        occurredOn: visit.localDate,
        dentistId: visit.dentistId,
        userId,
      },
      stored,
    );
  }

  /**
   * A line not done: plan work in progress, started (and accepted) in this visit with a session
   * there, priced 0 — the amount was charged before the migration and is in the opening balance.
   */
  private async startPlan(
    visit: StoredVisit,
    { line, service }: ResolvedLine,
    userId: string,
    currency: string,
  ) {
    const charged =
      toCents(line.amount) > 0n ? `Charged ${line.amount} before the migration` : null;
    const plan = await this.plans.insert({
      patientId: visit.patientId,
      toothCode: line.tooth,
      jaw: line.jaw,
      surfaces: [],
      procedureId: service.id,
      code: service.code,
      name: service.name,
      category: service.category,
      chargeUnit: service.chargeUnit,
      priceAmount: '0',
      priceCurrency: currency,
      diagnosisRecordId: null,
      priority: 'high',
      estimatedSessions: service.typicalSessions,
      note: charged,
      dentistId: visit.dentistId,
      recordedBy: userId,
      recordedInVisitId: visit.id,
      recordedAt: visit.startedAt,
    });
    await this.plans.update(plan.id, {
      status: 'in_progress',
      acceptedAt: visit.startedAt,
      acceptedBy: userId,
      startedInVisitId: visit.id,
      startedAt: visit.startedAt,
    });
    await this.sessions.insert({
      planId: plan.id,
      visitId: visit.id,
      note: null,
      recordedBy: userId,
    });
  }

  /** Each line's service by code, its target matching the service's unit (W11). */
  private async resolve(lines: readonly ImportVisitLine[]): Promise<ResolvedLine[]> {
    const byCode = new Map((await this.procedures.list()).map((item) => [item.code, item]));
    const issues: ValidationIssue[] = [];
    const resolved = lines.flatMap((line, index): ResolvedLine[] => {
      const at = (field: string) => `lines.${String(index)}.${field}`;
      const service = byCode.get(line.serviceCode);
      if (!service) {
        issues.push({
          path: at('serviceCode'),
          code: 'unknown_service',
          message: 'No such service',
        });
        return [];
      }
      if ((line.tooth !== null) !== (service.chargeUnit === 'per_tooth')) {
        issues.push({
          path: at('tooth'),
          code: 'target_mismatch',
          message: `${service.code} is charged ${service.chargeUnit}: a tooth only for per_tooth`,
        });
      }
      if ((line.jaw !== null) !== (service.chargeUnit === 'per_jaw')) {
        issues.push({
          path: at('jaw'),
          code: 'target_mismatch',
          message: `${service.code} is charged ${service.chargeUnit}: a jaw only for per_jaw`,
        });
      }
      return [{ line, service }];
    });
    if (issues.length > 0) throw invalid(issues);
    return resolved;
  }

  /** An end time needs a start time, not after it: the duration comes from both (at least 1 minute). */
  private assertTimes({ startTime, endTime }: VisitImport): void {
    if (endTime === null) return;
    if (startTime === null) {
      throw invalid([
        { path: 'startTime', code: 'required', message: 'An end time needs a start time' },
      ]);
    }
    if (endTime < startTime) {
      throw invalid([
        { path: 'endTime', code: 'before_start', message: 'The visit ends before it starts' },
      ]);
    }
  }

  /**
   * A staff member of the clinic, active or not: a past visit may be a dentist's who has left
   * since (unlike `start`, no branch or active check).
   */
  private async assertDentist(dentistId: string): Promise<void> {
    const [found] = await this.users.practitionersByProfileIds([dentistId]);
    if (!found) throw new DentistInvalidError('The dentist must be a staff member of this clinic');
  }

  /** Any room of the branch, active or not: the visit happened there. */
  private async assertRoom(branchId: string, roomId: string | null): Promise<void> {
    if (roomId === null) return;
    const rooms = await this.tenancy.listRooms(branchId);
    if (!rooms.some((room) => room.id === roomId)) {
      throw new RoomInvalidError('The room must be a room of this branch');
    }
  }
}

function invalid(issues: ValidationIssue[]): ValidationFailedError {
  return new ValidationFailedError(
    issues.length === 1 ? '1 field is invalid' : `${String(issues.length)} fields are invalid`,
    issues,
  );
}
