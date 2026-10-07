import { toothCodeSchema, type ToothPresenceChange, type ToothPresenceState } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { EventBus } from '../../../platform/events/event-bus';
import { AuditService } from '../../audit';
import { TOOTH_PRESENCE_CHANGED, type ToothPresenceChanged } from '../events/record-events';
import { ProceduresRepository } from '../persistence/procedures.repository';
import {
  type StoredToothPresence,
  ToothPresenceRepository,
} from '../persistence/tooth-presence.repository';

const PRESENCE = 'tooth_presence';

/** The presence a catalog effect leaves a tooth with (H2). */
const EFFECT_PRESENCE = { removes: 'missing', implant: 'implant' } as const;

/** Who sets a presence, where, and for whom. `visitId` null is the patient record. */
export interface PresenceContext {
  patientId: string;
  visitId: string | null;
  /** The visit's local date, or what was entered on the patient record (null = before first
   * visit). */
  occurredOn: string | null;
  dentistId: string;
  userId: string;
}

/** A visit service as the writer needs it: where it is and what the catalog says it does. */
interface ServiceRef {
  id: string;
  procedureId: string;
  toothCode: string | null;
}

/**
 * The one write path of tooth presence (feature 7, H1–H3; ADR-0034), shared by charting in a
 * visit, charting on the patient record, amendments and voids. Internal to `clinical` and not
 * permission-gated: its callers checked `visit:write`, `chart:write`, `visit:amend` or
 * `visit:void` and hold the visit or the patient locked, in the transaction this joins.
 *
 * A presence is never overwritten. Setting one by hand adds a row, unless the tooth already has
 * that presence (then nothing is written). A service with an effect always adds its own row,
 * even on a tooth already in that state (re-work on an implant, an extraction on a gap): the
 * chart does not change, but the tooth then stays so for as long as any such service stands,
 * whichever of them is removed first. Taking a row back — an Undo, the removal of the service
 * that caused it — soft-deletes it, and the latest row left is the tooth's presence again. Every write is audited (`tooth_presence.set` /
 * `.remove`) and publishes `ToothPresenceChanged` with the presence the tooth now has.
 */
@Injectable()
export class PresenceWriter {
  constructor(
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly presences: ToothPresenceRepository,
    private readonly procedures: ProceduresRepository,
  ) {}

  /** Sets a tooth's presence by hand; null when it already had it. */
  async set(
    context: PresenceContext,
    change: { toothCode: string; presence: ToothPresenceState; reason?: string | null },
  ): Promise<StoredToothPresence | null> {
    const current = await this.presences.currentFor(context.patientId, change.toothCode);
    if (current === change.presence) return null;
    return this.write(context, change, null, current);
  }

  /** Adds the row, audits it, and publishes the change when the tooth's presence moved. */
  private async write(
    context: PresenceContext,
    change: { toothCode: string; presence: ToothPresenceState; reason?: string | null },
    serviceId: string | null,
    current: ToothPresenceState,
  ): Promise<StoredToothPresence> {
    const row = await this.presences.insert({
      patientId: context.patientId,
      toothCode: change.toothCode,
      presence: change.presence,
      occurredOn: context.occurredOn,
      reason: change.reason ?? null,
      dentistId: context.dentistId,
      recordedInVisitId: context.visitId,
      serviceId,
      recordedBy: context.userId,
    });
    await this.audit.record({
      action: `${PRESENCE}.set`,
      resourceType: PRESENCE,
      resourceId: row.id,
      patientId: context.patientId,
      visitId: context.visitId ?? undefined,
      before: { toothCode: row.toothCode, presence: current },
      after: row,
      reason: row.reason ?? undefined,
    });
    if (current !== row.presence) await this.changed(row, row.presence);
    return row;
  }

  /**
   * What recording a service does to its tooth (H2): the catalog says whether it takes the tooth
   * out or puts an implant there. Its row is written even when the tooth is already so; the
   * answer is null then (nothing changed on the chart), and when the service has no effect.
   */
  async applyService(
    context: PresenceContext,
    service: ServiceRef,
  ): Promise<ToothPresenceChange | null> {
    if (service.toothCode === null) return null;
    const effect = await this.procedures.toothEffectOf(service.procedureId);
    if (effect === 'none') return null;
    const presence = EFFECT_PRESENCE[effect];
    const current = await this.presences.currentFor(context.patientId, service.toothCode);
    await this.write(context, { toothCode: service.toothCode, presence }, service.id, current);
    return current === presence
      ? null
      : { toothCode: toothCodeSchema.parse(service.toothCode), presence };
  }

  /**
   * Takes back what a service did to its tooth: the service was removed, marked not finished, or
   * amended away. Answers with the presence the tooth is back to, or null when the chart does not
   * change (the service had no effect, or another row still holds the tooth in that state).
   */
  async revertService(serviceId: string, at: Date): Promise<ToothPresenceChange | null> {
    const row = await this.presences.liveForService(serviceId);
    if (!row) return null;
    const before = await this.presences.currentFor(row.patientId, row.toothCode);
    const [change] = await this.remove([row], at);
    return change && change.presence !== before ? change : null;
  }

  /** An amendment moved a service to another tooth: its effect moves with it. */
  async moveService(
    context: PresenceContext,
    service: { id: string; toothCode: string | null },
    at: Date,
  ): Promise<void> {
    const row = await this.presences.liveForService(service.id);
    if (!row || row.toothCode === service.toothCode) return;
    await this.remove([row], at);
    if (service.toothCode === null) return;
    const current = await this.presences.currentFor(context.patientId, service.toothCode);
    await this.write(
      context,
      { toothCode: service.toothCode, presence: row.presence },
      service.id,
      current,
    );
  }

  /** A void: every tooth a service of the visit changed goes back (H2). Presence set by hand in
   * the visit stays: it is what the dentist saw (D4). */
  async revertVisit(visitId: string, at: Date): Promise<void> {
    await this.remove(await this.presences.liveByServicesOf(visitId), at);
  }

  /** Soft-deletes rows, audits each and answers with the presence each tooth is back to. */
  async remove(rows: readonly StoredToothPresence[], at: Date): Promise<ToothPresenceChange[]> {
    await this.presences.remove(
      rows.map((row) => row.id),
      at,
    );
    const changes: ToothPresenceChange[] = [];
    for (const row of rows) {
      const presence = await this.presences.currentFor(row.patientId, row.toothCode);
      await this.audit.record({
        action: `${PRESENCE}.remove`,
        resourceType: PRESENCE,
        resourceId: row.id,
        patientId: row.patientId,
        visitId: row.recordedInVisitId ?? undefined,
        before: row,
        after: { toothCode: row.toothCode, presence, deletedAt: at },
      });
      // Removing a row that another one repeats changes nothing on the chart.
      if (presence !== row.presence) await this.changed(row, presence);
      changes.push({ toothCode: toothCodeSchema.parse(row.toothCode), presence });
    }
    return changes;
  }

  private async changed(row: StoredToothPresence, presence: ToothPresenceState): Promise<void> {
    const event: ToothPresenceChanged = this.events.create(TOOTH_PRESENCE_CHANGED, {
      patientId: row.patientId,
      visitId: row.recordedInVisitId,
      toothCode: row.toothCode,
      presence,
    });
    await this.events.publish(event);
  }
}
