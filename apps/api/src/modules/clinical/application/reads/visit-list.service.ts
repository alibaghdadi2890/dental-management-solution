import {
  patientListQuerySchema,
  type VisitFilters,
  type VisitListItem,
  type VisitListQuery,
  type VisitListSummary,
  type VisitListTab,
  type VisitPage,
  type VisitStats,
  type VisitStatus,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../../platform/clock/clock.module';
import { RequestContext } from '../../../../platform/cls/request-context';
import { TenantDb } from '../../../../platform/db/tenant-db';
import type { Clock } from '../../../../platform/kernel/clock';
import { localDate } from '../../../../platform/kernel/local-date';
import { PatientsService } from '../../../patients';
import { TenancyService } from '../../../tenancy';
import { UsersService } from '../../../users';
import { decodeVisitCursor, encodeVisitCursor } from '../../domain/visit-cursor';
import { isLive, LIVE_VISIT_STATUSES } from '../../domain/visit-lifecycle';
import { addDays, rangeStart } from '../../domain/visit-range';
import { VisitAmendmentsRepository } from '../../persistence/visit-amendments.repository';
import { VisitServicesRepository } from '../../persistence/visit-services.repository';
import type { VisitCriteria, VisitTextMatch } from '../../persistence/visit-search.sql';
import { type StoredVisit, VisitsRepository } from '../../persistence/visits.repository';
import { moneyOf, toVisitService } from '../visits/visit-mapping';
import { ownedFilter, visitMoneyVisible } from '../visits/visit-scope';

/** Options only other modules' services pass (`billing`'s Unpaid tab), never over HTTP. */
export interface VisitSearchInternal {
  /** Restricts the list to these visits; an empty list matches nothing. */
  idsIn?: readonly string[];
}

/** Which statuses each tab lists; discarded visits never appear (D11). */
const TAB_STATUSES: Record<VisitListTab, readonly VisitStatus[]> = {
  all: ['in_progress', 'paused', 'completed', 'amended', 'voided'],
  in_progress: LIVE_VISIT_STATUSES,
  voided_amended: ['amended', 'voided'],
  history: ['completed', 'amended', 'voided'],
};

/** `V-123`, `v123` or `123` (leading zeros allowed) reads as a visit number. */
const VISIT_NUMBER_QUERY = /^(?:v-?)?0*(\d{1,9})$/i;

/**
 * The visits list and the per-patient visit stats (docs/modules/clinical.md, feature 4b), for the
 * Visits screen and for `billing`'s visit and patient views. Every method needs `visit:read`. The
 * list, its summary and `aggregate` keep to the caller's visit scope (ADR-0055) and show a row's
 * money only to who may see it (`visitMoneyVisible`); the per-patient facts (`lastVisitFor`,
 * `patientIdsSeenWithin`) are about the patient, not a visit, and are not scoped.
 */
@Injectable()
export class VisitListService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly tenancy: TenancyService,
    private readonly patients: PatientsService,
    private readonly users: UsersService,
    private readonly visits: VisitsRepository,
    private readonly services: VisitServicesRepository,
    private readonly amendments: VisitAmendmentsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The visits list (4b, spec §VisitsService), cursor-paged newest first: the session branch's
   * visits, or with `patientId` one patient's in every branch; never discarded ones. No branch in
   * the session (and no patient) → an empty page. `internal.idsIn` is `billing`'s Unpaid tab.
   * Each row carries its patient, dentist, room, services, money (computed while live) and
   * amendment count.
   */
  async search(query: VisitListQuery, internal: VisitSearchInternal = {}): Promise<VisitPage> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(async () => {
      const criteria = await this.criteriaFor(query, internal);
      if (!criteria) return { items: [], nextCursor: null };
      const after = query.cursor === undefined ? undefined : decodeVisitCursor(query.cursor);
      const rows = await this.visits.page(criteria, after, query.limit + 1);
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: await this.listItems(page),
        nextCursor:
          rows.length > query.limit && last
            ? encodeVisitCursor({ startedAt: last.startedAt, id: last.id })
            : null,
      };
    });
  }

  /** The list footer and tab chips for the same filters (D12); see `VisitListSummary`. */
  async summary(query: VisitFilters): Promise<VisitListSummary> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(async () => {
      const criteria = await this.criteriaFor(query, {});
      if (!criteria) {
        return {
          count: 0,
          billed: [],
          tabs: { all: 0, inProgress: 0, voidedAmended: 0, today: 0 },
        };
      }
      const { count, billed } = await this.visits.aggregate(criteria);
      return {
        count,
        // Σ across patients is clinic money (ADR-0055).
        billed: this.context.hasPermission('finance:read') ? billed : null,
        tabs: await this.visits.tabCounts(criteria.scope, criteria.own, await this.today()),
      };
    });
  }

  /** Count and billed sums of the matching visits among `internal.idsIn` (`billing`'s Unpaid). */
  async aggregate(
    query: VisitFilters,
    internal: VisitSearchInternal,
  ): Promise<{ count: number; billed: { currency: string; amount: string }[] }> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(async () => {
      const criteria = await this.criteriaFor(query, internal);
      return criteria ? this.visits.aggregate(criteria) : { count: 0, billed: [] };
    });
  }

  /**
   * Last visit and visit count per patient (D18: counted visits only, any branch), in input
   * order; a patient without visits gets `lastVisitDate: null` and 0.
   */
  async lastVisitFor(patientIds: readonly string[]): Promise<VisitStats> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(async () => {
      const stats = new Map(
        (await this.visits.statsFor(patientIds)).map((row) => [row.patientId, row]),
      );
      return [...new Set(patientIds)].map((patientId) => ({
        patientId,
        lastVisitDate: stats.get(patientId)?.lastVisitDate ?? null,
        visitCount: stats.get(patientId)?.visitCount ?? 0,
      }));
    });
  }

  /**
   * Patients with a counted visit on or after the day `days` days before the tenant's today — or
   * ever, with `days: null` — for the patients list's *Not seen* view and *Never* filter (D18).
   */
  async patientIdsSeenWithin(days: number | null): Promise<string[]> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(async () =>
      this.visits.patientIdsSeenSince(days === null ? null : addDays(await this.today(), -days)),
    );
  }

  private async today(): Promise<string> {
    return localDate(this.clock.now(), (await this.tenancy.currentTenant()).timeZone);
  }

  /**
   * The list query resolved to repository criteria: scope (null without a branch or patient),
   * the tab's statuses, the date filter from the tenant's today, and `q` as a visit number, a
   * service, or the patients it finds (active and archived).
   */
  private async criteriaFor(
    query: VisitFilters,
    internal: VisitSearchInternal,
  ): Promise<VisitCriteria | null> {
    const own = ownedFilter(this.context);
    if (own === null) return null;
    const branchId = this.context.branchId;
    const scope =
      query.patientId !== undefined
        ? { patientId: query.patientId }
        : branchId
          ? { branchId }
          : null;
    if (!scope) return null;
    return {
      scope,
      statuses: TAB_STATUSES[query.tab],
      fromDate: rangeStart(query.range, await this.today()) ?? undefined,
      dentistId: query.dentistId,
      roomId: query.roomId,
      type: query.type,
      match: query.q === undefined ? undefined : await this.textMatch(query.q),
      idsIn: internal.idsIn,
      own,
    };
  }

  private async textMatch(q: string): Promise<VisitTextMatch> {
    const number = VISIT_NUMBER_QUERY.exec(q)?.[1];
    const patientIds = (
      await Promise.all(
        (['active', 'archived'] as const).map((view) =>
          this.patients.searchIds(patientListQuerySchema.parse({ q, view })),
        ),
      )
    ).flat();
    return {
      displayNumber: number === undefined ? undefined : Number(number),
      text: q,
      patientIds,
    };
  }

  /** List rows for `visits` (one page), with everything the list and the detail panel show. */
  private async listItems(visits: StoredVisit[]): Promise<VisitListItem[]> {
    if (visits.length === 0) return [];
    const ids = visits.map((visit) => visit.id);
    const services = await this.services.listForVisits(ids);
    const amendmentCounts = await this.amendments.countsFor(ids);
    const patients = new Map(
      (await this.patients.listItemsByIds(visits.map((visit) => visit.patientId))).map(
        (patient) => [patient.id, patient],
      ),
    );
    const dentists = new Map(
      (await this.users.practitionersByProfileIds(visits.map((visit) => visit.dentistId))).map(
        (practitioner) => [practitioner.id, practitioner.displayName],
      ),
    );
    const rooms = new Map((await this.tenancy.listRooms()).map((room) => [room.id, room.name]));
    const now = this.clock.now().toISOString();
    return visits.map((visit) => {
      const own = services.filter((service) => service.visitId === visit.id);
      const money = moneyOf(visit, own);
      const showMoney = visitMoneyVisible(this.context, visit);
      const patient = patients.get(visit.patientId);
      return {
        id: visit.id,
        displayNumber: visit.displayNumber,
        type: visit.type,
        currentStep: isLive(visit.status) ? visit.currentStep : 'complete',
        reason: visit.reason,
        status: visit.status,
        localDate: visit.localDate,
        startedAt: visit.startedAt.toISOString(),
        completedAt: visit.completedAt?.toISOString() ?? null,
        durationMinutes: visit.durationMinutes,
        pausedAt: visit.pausedAt?.toISOString() ?? null,
        pausedSeconds: visit.pausedSeconds,
        branchId: visit.branchId,
        room:
          visit.roomId === null ? null : { id: visit.roomId, name: rooms.get(visit.roomId) ?? '' },
        patient: {
          id: visit.patientId,
          displayNumber: patient?.displayNumber ?? '',
          fullName: patient?.fullName ?? '',
        },
        dentist: { id: visit.dentistId, name: dentists.get(visit.dentistId) ?? '' },
        services: own.map((service) => {
          const line = toVisitService(service, visit.currency);
          return {
            id: line.id,
            code: line.code,
            name: line.name,
            chargeUnit: line.chargeUnit,
            toothCode: line.toothCode,
            jaw: line.jaw,
            surfaces: line.surfaces,
            planId: line.planId,
            final: showMoney ? line.final : null,
          };
        }),
        notes: visit.notes,
        discount: showMoney ? { mode: visit.discountMode, value: visit.discountValue } : null,
        currency: visit.currency,
        subtotal: showMoney ? money.subtotal : null,
        discountAmount: showMoney ? money.discount : null,
        total: showMoney ? money.total : null,
        amendmentCount: amendmentCounts.get(visit.id) ?? 0,
        imported: visit.importedAt !== null,
        checkedOutAt: visit.checkedOutAt?.toISOString() ?? null,
        voidedAt: visit.voidedAt?.toISOString() ?? null,
        voidReason: visit.voidReason,
        updatedAt: visit.updatedAt.toISOString(),
        serverNow: now,
      };
    });
  }
}
