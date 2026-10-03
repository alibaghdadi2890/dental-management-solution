import {
  formatVisitNumber,
  fromCents,
  toCents,
  type UnpaidVisitsSummary,
  type VisitExportQuery,
  type VisitFilters,
  type VisitListItem,
  type VisitListQuery,
  type VisitPage,
  type VisitStatus,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate } from '../../../platform/kernel/local-date';
import { VisitsService } from '../../clinical';
import { TenancyService } from '../../tenancy';
import { csvRow, UTF8_BOM } from '../domain/csv';
import { AllocationsRepository } from '../persistence/allocations.repository';
import { LedgerEntriesRepository } from '../persistence/ledger-entries.repository';

type VisitColumnKey =
  | 'visit'
  | 'date'
  | 'time'
  | 'room'
  | 'patient'
  | 'patientId'
  | 'dentist'
  | 'services'
  | 'subtotal'
  | 'discount'
  | 'total'
  | 'paid'
  | 'balance'
  | 'status';

/** The visits export's header row and status values, in the caller's language. */
export type VisitExportLabels = Record<VisitColumnKey, string> & {
  statuses: Record<Exclude<VisitStatus, 'discarded'>, string>;
};

interface VisitRow {
  visit: VisitListItem;
  timeZone: string;
  labels: VisitExportLabels;
  paid: string;
  balance: string;
}

interface Column {
  key: VisitColumnKey;
  numeric?: true;
  value(row: VisitRow): string;
}

const TIME = (timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  });

/** The Visits table's columns plus the money and status (spec §Backend — billing). */
const COLUMNS: readonly Column[] = [
  { key: 'visit', value: ({ visit }) => formatVisitNumber(visit.displayNumber) },
  { key: 'date', value: ({ visit }) => visit.localDate },
  {
    key: 'time',
    value: ({ visit, timeZone }) => TIME(timeZone).format(new Date(visit.startedAt)),
  },
  { key: 'room', value: ({ visit }) => visit.room?.name ?? '' },
  { key: 'patient', value: ({ visit }) => visit.patient.fullName },
  { key: 'patientId', value: ({ visit }) => visit.patient.displayNumber },
  { key: 'dentist', value: ({ visit }) => visit.dentist.name },
  {
    key: 'services',
    value: ({ visit }) =>
      visit.services
        .map((service) =>
          service.toothCode ? `${service.name} #${service.toothCode}` : service.name,
        )
        .join('; '),
  },
  { key: 'subtotal', numeric: true, value: ({ visit }) => visit.subtotal },
  { key: 'discount', numeric: true, value: ({ visit }) => visit.discountAmount },
  { key: 'total', numeric: true, value: ({ visit }) => visit.total },
  { key: 'paid', numeric: true, value: ({ paid }) => paid },
  { key: 'balance', numeric: true, value: ({ balance }) => balance },
  {
    key: 'status',
    value: ({ visit, labels }) =>
      visit.status === 'discarded' ? '' : labels.statuses[visit.status],
  },
];

const NUMERIC_COLUMNS = COLUMNS.flatMap((column, index) => (column.numeric ? [index] : []));

/** Visits read per page while exporting. */
const PAGE_SIZE = 100;

export interface VisitExport {
  /** `visits-<tenant's today>.csv`. */
  fileName: string;
  chunks: AsyncGenerator<string>;
}

/**
 * The Visits screen's views that need the ledger (4b, spec §Backend — billing), composed on
 * `VisitsService` like the patient views: the *Unpaid* tab (visits whose entries still sum above
 * what is paid, `idsIn`), its summary, and the CSV export of any tab. Every method requires
 * `payment:read`; `VisitsService` re-checks `visit:read`.
 */
@Injectable()
export class VisitViewsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly tenancy: TenancyService,
    private readonly visits: VisitsService,
    private readonly entries: LedgerEntriesRepository,
    private readonly allocations: AllocationsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `GET /billing/visits/unpaid`: the list's page shape, owing visits only. */
  async unpaid(query: VisitListQuery): Promise<VisitPage> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () =>
      this.visits.search(
        { ...query, tab: 'all' },
        { idsIn: await this.allocations.visitIdsOwing() },
      ),
    );
  }

  /** The Unpaid footer for the filters, and the tab chip without them. */
  async unpaidSummary(query: VisitFilters): Promise<UnpaidVisitsSummary> {
    this.context.requirePermission('payment:read');
    return this.tenantDb.run(async () => {
      const idsIn = await this.allocations.visitIdsOwing();
      const filtered = await this.visits.aggregate({ ...query, tab: 'all' }, { idsIn });
      const tab = await this.visits.aggregate(
        { tab: 'all', range: 'all', q: undefined, patientId: query.patientId },
        { idsIn },
      );
      return { ...filtered, tabCount: tab.count };
    });
  }

  /**
   * The current tab and filters as CSV, newest first, read a cursor page at a time as the chunks
   * are pulled (the cursor never repeats or skips a row). The permission checks and the first
   * page run before anything is sent.
   */
  async open(query: VisitExportQuery, labels: VisitExportLabels): Promise<VisitExport> {
    this.context.requirePermission('payment:read');
    this.context.requirePermission('visit:read');
    const { timeZone } = await this.tenancy.currentTenant();
    const { lang: _lang, tab, ...filters } = query;
    const idsIn = tab === 'unpaid' ? await this.allocations.visitIdsOwing() : undefined;
    const listQuery = { ...filters, tab: tab === 'unpaid' ? 'all' : tab } as const;
    return {
      fileName: `visits-${localDate(this.clock.now(), timeZone)}.csv`,
      chunks: this.chunks(listQuery, idsIn, { timeZone, labels }),
    };
  }

  private async *chunks(
    query: VisitFilters,
    idsIn: readonly string[] | undefined,
    shared: Pick<VisitRow, 'timeZone' | 'labels'>,
  ): AsyncGenerator<string> {
    let head = UTF8_BOM + csvRow(COLUMNS.map(({ key }) => shared.labels[key]));
    let cursor: string | undefined;
    do {
      const page = await this.visits.search(
        { ...query, limit: PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) },
        idsIn === undefined ? {} : { idsIn },
      );
      const money = await this.moneyOf(page.items);
      const lines = page.items.map((visit) =>
        csvRow(
          COLUMNS.map((column) => column.value({ ...shared, visit, ...money(visit) })),
          { numericColumns: NUMERIC_COLUMNS },
        ),
      );
      if (lines.length > 0) {
        yield head + lines.join('');
        head = '';
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    if (head) yield head;
  }

  /** Paid and balance per visit (live and voided visits: what their entries net to, often 0). */
  private async moneyOf(visits: VisitListItem[]) {
    const sums = new Map(
      (await this.entries.sumsByVisit(visits.map((visit) => visit.id))).map((sum) => [
        sum.visitId,
        sum.amount,
      ]),
    );
    const allocated = await this.allocations.allocatedToVisits(visits.map((visit) => visit.id));
    return (visit: VisitListItem) => {
      const paid = allocated.get(visit.id)?.all ?? 0n;
      const charged = toCents(sums.get(visit.id) ?? '0');
      return { paid: fromCents(paid), balance: fromCents(charged - paid) };
    };
  }
}
