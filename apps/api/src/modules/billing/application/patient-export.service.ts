import {
  ageOn,
  formatPhone,
  type PatientExportQuery,
  type PatientListItem,
  type PatientSex,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate } from '../../../platform/kernel/local-date';
import { PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { UsersService } from '../../users';
import { csvRow, UTF8_BOM } from '../domain/csv';
import { LedgerEntriesRepository } from '../persistence/ledger-entries.repository';
import { type PatientViewQuery, PatientViewsService } from './patient-views.service';

/** The header row and the sex values, in the caller's language (`http/export-headers.ts`). */
export interface ExportLabels {
  patientId: string;
  name: string;
  age: string;
  sex: string;
  phone: string;
  lastVisit: string;
  dentist: string;
  visits: string;
  /** The tenant currency is appended: `Balance (USD)`. */
  balance: string;
  /** `unknown` is exported as an empty cell. */
  sexes: Record<Exclude<PatientSex, 'unknown'>, string>;
}

type ExportPatient = Pick<
  PatientListItem,
  'id' | 'displayNumber' | 'fullName' | 'phone' | 'dateOfBirth' | 'sex' | 'primaryDentistUserId'
>;

/** Pages of the view walked by the export (`search`'s internal maximum). */
const EXPORT_PAGE_SIZE = 500;

/** Age, Visits and Balance: written from numbers, so a leading `-` is not a formula. */
const NUMERIC_COLUMNS = [2, 7, 8];

const NO_BALANCE = '0.00';

/**
 * The Patients list as CSV (design Q4, docs/modules/billing.md): the table's columns — Patient
 * ID, Name, Age, Sex, Phone, Last visit, Dentist, Visits, Balance (tenant currency) — for the
 * selected `ids` in that order, or for every patient of the filtered and sorted view. Requires
 * `payment:read` and `patient:read`.
 */
@Injectable()
export class PatientExportService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenancy: TenancyService,
    private readonly patients: PatientsService,
    private readonly users: UsersService,
    private readonly views: PatientViewsService,
    private readonly entries: LedgerEntriesRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The file as chunks: the first holds the byte order mark, the header row and the first page
   * of rows; each later one a page (up to 500 rows). CRLF line ends (RFC 4180). Nothing runs
   * until the first chunk is pulled, which is where the permission checks and the first read
   * fail — before a caller has sent anything.
   */
  async *stream(query: PatientExportQuery, labels: ExportLabels): AsyncGenerator<string> {
    this.context.requirePermission('payment:read');
    this.context.requirePermission('patient:read');
    const tenant = await this.tenancy.currentTenant();
    const today = localDate(this.clock.now(), tenant.timeZone);
    const dentistNames = new Map<string, string>();
    let head =
      UTF8_BOM +
      csvRow([
        labels.patientId,
        labels.name,
        labels.age,
        labels.sex,
        labels.phone,
        labels.lastVisit,
        labels.dentist,
        labels.visits,
        `${labels.balance} (${tenant.currency})`,
      ]);
    for await (const batch of this.batches(query)) {
      const balances = await this.balancesIn(batch, tenant.currency);
      await this.resolveDentists(batch, dentistNames);
      const lines = batch.map((patient) =>
        csvRow(
          [
            patient.displayNumber,
            patient.fullName,
            patient.dateOfBirth === null ? '' : String(ageOn(patient.dateOfBirth, today)),
            patient.sex === 'unknown' ? '' : labels.sexes[patient.sex],
            formatPhone(patient.phone),
            // Last visit and Visits: empty until visits exist (feature 4).
            '',
            patient.primaryDentistUserId === null
              ? ''
              : (dentistNames.get(patient.primaryDentistUserId) ?? ''),
            '',
            balances.get(patient.id) ?? NO_BALANCE,
          ],
          { numericColumns: NUMERIC_COLUMNS },
        ),
      );
      yield head + lines.join('');
      head = '';
    }
    if (head) yield head;
  }

  /** `patients-<tenant's today>.csv`. */
  async fileName(): Promise<string> {
    const { timeZone } = await this.tenancy.currentTenant();
    return `patients-${localDate(this.clock.now(), timeZone)}.csv`;
  }

  /**
   * `ids`: those patients in that order, in one batch (at most 100); ids the tenant can't see
   * are skipped. Otherwise the view's pages (the filters and sort of the list, `owing` and
   * `balance` included).
   */
  private async *batches(query: PatientExportQuery): AsyncGenerator<ExportPatient[]> {
    const { ids, ...view } = query;
    if (ids === undefined) {
      const viewQuery: PatientViewQuery = view;
      yield* this.views.pages(viewQuery, EXPORT_PAGE_SIZE);
      return;
    }
    const found = new Map(
      (await this.patients.getMany(ids)).map((patient) => [patient.id, patient]),
    );
    const ordered = ids.flatMap((id) => {
      const patient = found.get(id);
      return patient ? [patient] : [];
    });
    if (ordered.length > 0) yield ordered;
  }

  /** Each patient's balance in the tenant currency; absent = none. */
  private async balancesIn(
    batch: readonly ExportPatient[],
    currency: string,
  ): Promise<Map<string, string>> {
    const sums = await this.entries.sumsByPatient(batch.map((patient) => patient.id));
    return new Map(
      sums.filter((sum) => sum.currency === currency).map((sum) => [sum.patientId, sum.amount]),
    );
  }

  /** Adds the display names of the batch's dentists not seen in an earlier batch. */
  private async resolveDentists(
    batch: readonly ExportPatient[],
    names: Map<string, string>,
  ): Promise<void> {
    const unseen = [
      ...new Set(
        batch.flatMap((patient) =>
          patient.primaryDentistUserId === null || names.has(patient.primaryDentistUserId)
            ? []
            : [patient.primaryDentistUserId],
        ),
      ),
    ];
    if (unseen.length === 0) return;
    for (const id of unseen) names.set(id, '');
    for (const practitioner of await this.users.practitionersByIds(unseen)) {
      names.set(practitioner.userId, practitioner.displayName);
    }
  }
}
