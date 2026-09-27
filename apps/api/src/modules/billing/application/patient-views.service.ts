import type { OwingCount, PatientListItem, PatientListQuery, PatientPage } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { type PatientSearchInternal, PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { type BalanceRank, rankByBalance } from '../domain/balances';
import { LedgerEntriesRepository } from '../persistence/ledger-entries.repository';
import { BillingService } from './billing.service';

/** The list query without paging: what a walk over a whole view (the CSV export) takes. */
export type PatientViewQuery = Omit<PatientListQuery, 'page' | 'size'>;

/** `search` ignores `query.size` when `internal.size` is set; any valid size will do. */
const IGNORED_PAGE_SIZE: PatientListQuery['size'] = 50;

const ACTIVE_BY_NAME: PatientListQuery = {
  view: 'active',
  q: undefined,
  sort: 'name',
  dir: 'asc',
  page: 1,
  size: IGNORED_PAGE_SIZE,
};

/**
 * The Patients list views that need balances (design Q5, ADR-0017): `billing` composes them on
 * `PatientsService.search` with its internal options, so `patients` never imports `billing`.
 * - `view=owing`: the active patients owing in any currency (`idsIn`).
 * - `sort=balance`: ranked by the tenant-currency balance (`rank`, `rankByBalance`), in any view.
 *
 * Every method requires `payment:read`; `search` re-checks `patient:read`.
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

  /**
   * Every patient of a view, in pages of `size` (≤ 500), in the view's order — for the export.
   * The owing ids and the balance rank are computed once, so every page is cut from the same
   * order. Each page is its own read (ADR-0018: rows written meanwhile may shift across pages).
   */
  async *pages(query: PatientViewQuery, size: number): AsyncGenerator<PatientListItem[]> {
    this.context.requirePermission('payment:read');
    const internal: PatientSearchInternal = { ...(await this.internalFor(query)), size };
    for (let page = 1; ; page += 1) {
      const result = await this.patients.search(
        searchable({ ...query, page, size: IGNORED_PAGE_SIZE }),
        internal,
      );
      if (result.items.length > 0) yield result.items;
      if (result.items.length < size || page * size >= result.total) return;
    }
  }

  private async internalFor(query: PatientViewQuery): Promise<PatientSearchInternal> {
    const internal: PatientSearchInternal = {};
    if (query.view === 'owing') internal.idsIn = await this.billing.patientIdsOwing();
    if (query.sort === 'balance') internal.rank = await this.balanceRank(query.dir);
    return internal;
  }

  /** Every non-zero tenant-currency balance, ranked (other currencies count as zero). */
  private async balanceRank(dir: 'asc' | 'desc'): Promise<BalanceRank> {
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
function searchable(query: PatientListQuery): PatientListQuery {
  return query.view === 'owing' ? { ...query, view: 'active' } : query;
}
