import type { OwingCount, PatientListQuery, PatientPage } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { VisitsService } from '../../clinical';
import { type PatientRankKeys, type PatientSearchInternal, PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { rankByBalance } from '../domain/balances';
import { LedgerEntriesRepository } from '../persistence/ledger-entries.repository';
import { BillingService } from './billing.service';

/** The list query without paging: what a snapshot of a whole view (the CSV export) takes. */
export type PatientViewQuery = Omit<PatientListQuery, 'page' | 'size'>;

/** *Not seen 6+ months* (4b, D18): no counted visit in the 180 days before today. */
const NOT_SEEN_DAYS = 180;

/** The counts' query; `internal.size: 1` makes it a one-row page (only the total counts). */
const ACTIVE_BY_NAME: PatientListQuery = {
  view: 'active',
  q: undefined,
  sort: 'name',
  dir: 'asc',
  page: 1,
  size: 10,
};

/**
 * The Patients list views that need another module's data (design Q5, ADR-0017): `billing`
 * composes them on `PatientsService.search` with its internal options, so `patients` never
 * imports `billing` or `clinical`.
 * - `view=owing`: the active patients owing in any currency (`idsIn`).
 * - `sort=balance`: ranked by the tenant-currency balance (`rank`, `rankByBalance`), in any view.
 * - `view=notSeen` (4b): active patients without a counted visit in the last 180 days, and
 *   `lastVisit=never`: patients without any (`idsNotIn`, from `clinical`). Both combine with
 *   the others.
 *
 * Every method requires `payment:read`; `search`/`searchIds` re-check `patient:read`, and the
 * visit facts `visit:read`.
 */
@Injectable()
export class PatientViewsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly tenancy: TenancyService,
    private readonly patients: PatientsService,
    private readonly billing: BillingService,
    private readonly entries: LedgerEntriesRepository,
    private readonly visits: VisitsService,
  ) {}

  /** `GET /billing/patients`: any valid list query, same page shape as `GET /patients`. */
  async list(query: PatientListQuery): Promise<PatientPage> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () =>
      this.patients.search(searchable(query), await this.internalFor(query)),
    );
  }

  /** The Owes balance tab chip: active patients owing in any currency. */
  async owingCount(): Promise<OwingCount> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () => {
      const idsIn = await this.billing.patientIdsOwing();
      const page = await this.patients.search(ACTIVE_BY_NAME, { idsIn, size: 1 });
      return { count: page.total };
    });
  }

  /** The Not seen tab chip: active patients without a counted visit in the last 180 days. */
  async notSeenCount(): Promise<OwingCount> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () => {
      const idsNotIn = await this.visits.patientIdsSeenWithin(NOT_SEEN_DAYS);
      const page = await this.patients.search(ACTIVE_BY_NAME, { idsNotIn, size: 1 });
      return { count: page.total };
    });
  }

  /**
   * Every patient id of a view, in the view's order, unpaged (`PatientsService.searchIds`): the
   * export's snapshot, so rows written while it streams never shift or repeat.
   */
  async idsFor(query: PatientViewQuery): Promise<string[]> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () =>
      this.patients.searchIds(searchable(query), await this.internalFor(query)),
    );
  }

  private async internalFor(query: PatientViewQuery): Promise<PatientSearchInternal> {
    const internal: PatientSearchInternal = {};
    if (query.view === 'owing') internal.idsIn = await this.billing.patientIdsOwing();
    if (query.sort === 'balance') internal.rank = await this.balanceRank(query.dir);
    if (query.lastVisit === 'never') {
      internal.idsNotIn = await this.visits.patientIdsSeenWithin(null);
    } else if (query.view === 'notSeen') {
      internal.idsNotIn = await this.visits.patientIdsSeenWithin(NOT_SEEN_DAYS);
    }
    return internal;
  }

  /** Every non-zero tenant-currency balance, ranked (other currencies count as zero). */
  private async balanceRank(dir: 'asc' | 'desc'): Promise<PatientRankKeys> {
    const { currency } = await this.tenancy.currentTenant();
    const sums = await this.entries.sumsInCurrency(currency);
    const balances = sums.map(({ patientId, amount }) => ({
      patientId,
      balances: [{ amount, currency }],
    }));
    return rankByBalance(balances, dir, currency);
  }
}

/** The owing view is the active view restricted to the owing ids (`internalFor`). */
function searchable<TQuery extends PatientViewQuery>(query: TQuery): TQuery {
  return query.view === 'owing' ? { ...query, view: 'active' } : query;
}
