import {
  ageOn,
  formatPhoneFor,
  type Patient,
  type PatientExportQuery,
  type PatientSex,
  type Tenant,
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
import { PatientViewsService } from './patient-views.service';

type ColumnKey =
  'patientId' | 'name' | 'age' | 'sex' | 'phone' | 'lastVisit' | 'dentist' | 'visits' | 'balance';

/** The header row and the sex values, in the caller's language (`http/export-headers.ts`). */
export type ExportLabels = Record<ColumnKey, string> & {
  /** `unknown` is exported as an empty cell. */
  sexes: Record<Exclude<PatientSex, 'unknown'>, string>;
};

/** A prepared export: the download's file name and its content, in chunks. */
export interface PatientExport {
  /** `patients-<tenant's today>.csv`. */
  fileName: string;
  /**
   * The first chunk holds the byte order mark, the header row and the first rows; each later one
   * up to 500 rows. CRLF line ends (RFC 4180).
   */
  chunks: AsyncGenerator<string>;
}

type ExportPatient = Pick<
  Patient,
  'id' | 'displayNumber' | 'fullName' | 'phone' | 'dateOfBirth' | 'sex' | 'primaryDentistUserId'
>;

/** What a row is written from: the patient plus what the export looked up for its chunk. */
interface RowContext {
  patient: ExportPatient;
  tenant: Tenant;
  today: string;
  labels: ExportLabels;
  balance: string | undefined;
  dentistName: string | undefined;
}

interface Column {
  key: ColumnKey;
  /** Written from a number: a decimal string keeps its leading `-` (CSV injection guard). */
  numeric?: true;
  value(row: RowContext): string;
}

/** The Patients table's columns, in its order (design Q4). */
const COLUMNS: readonly Column[] = [
  { key: 'patientId', value: ({ patient }) => patient.displayNumber },
  { key: 'name', value: ({ patient }) => patient.fullName },
  {
    key: 'age',
    numeric: true,
    value: ({ patient, today }) =>
      patient.dateOfBirth === null ? '' : String(ageOn(patient.dateOfBirth, today)),
  },
  {
    key: 'sex',
    value: ({ patient, labels }) => (patient.sex === 'unknown' ? '' : labels.sexes[patient.sex]),
  },
  // The tenant country's numbers nationally (`03 123 456`); others internationally, which the
  // injection guard then prefixes with `'` (a leading `+` would be evaluated).
  { key: 'phone', value: ({ patient, tenant }) => formatPhoneFor(patient.phone, tenant.country) },
  // Last visit and Visits: empty until visits exist (feature 4).
  { key: 'lastVisit', value: () => '' },
  { key: 'dentist', value: ({ dentistName }) => dentistName ?? '' },
  { key: 'visits', numeric: true, value: () => '' },
  { key: 'balance', numeric: true, value: ({ balance }) => balance ?? NO_BALANCE },
];

const NUMERIC_COLUMNS = COLUMNS.flatMap((column, index) => (column.numeric ? [index] : []));

/** Rows fetched and written per chunk. */
const CHUNK_SIZE = 500;

const NO_BALANCE = '0.00';

/**
 * The Patients list as CSV (design Q4, docs/modules/billing.md): the table's columns for the
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
   * Checks the permissions and takes the snapshot — the ids to export, in order (the given `ids`,
   * or the whole view via `PatientViewsService.idsFor`) — before anything is sent, so these
   * failures reach the caller as errors. The rows are then read `CHUNK_SIZE` at a time with
   * `getMany` as the chunks are pulled, in snapshot order: rows written meanwhile never shift or
   * repeat, and a patient that disappeared from view (not possible today: nothing is hard
   * deleted) would be skipped.
   */
  async open(query: PatientExportQuery, labels: ExportLabels): Promise<PatientExport> {
    this.context.requirePermission('payment:read');
    this.context.requirePermission('patient:read');
    const tenant = await this.tenancy.currentTenant();
    const today = localDate(this.clock.now(), tenant.timeZone);
    const { ids, lang: _lang, ...view } = query;
    const snapshot = ids ?? (await this.views.idsFor(view));
    return {
      fileName: `patients-${today}.csv`,
      chunks: this.chunks(snapshot, { tenant, today, labels }),
    };
  }

  private async *chunks(
    ids: readonly string[],
    shared: Pick<RowContext, 'tenant' | 'today' | 'labels'>,
  ): AsyncGenerator<string> {
    const dentistNames = new Map<string, string>();
    let head =
      UTF8_BOM +
      csvRow(
        COLUMNS.map(({ key }) =>
          key === 'balance'
            ? `${shared.labels.balance} (${shared.tenant.currency})`
            : shared.labels[key],
        ),
      );
    for (let start = 0; start < ids.length; start += CHUNK_SIZE) {
      const batch = await this.patientsIn(ids.slice(start, start + CHUNK_SIZE));
      if (batch.length === 0) continue;
      const balances = await this.balancesIn(batch, shared.tenant.currency);
      await this.resolveDentists(batch, dentistNames);
      const lines = batch.map((patient) => {
        const row: RowContext = {
          ...shared,
          patient,
          balance: balances.get(patient.id),
          dentistName:
            patient.primaryDentistUserId === null
              ? undefined
              : dentistNames.get(patient.primaryDentistUserId),
        };
        return csvRow(
          COLUMNS.map((column) => column.value(row)),
          { numericColumns: NUMERIC_COLUMNS },
        );
      });
      yield head + lines.join('');
      head = '';
    }
    if (head) yield head;
  }

  /** The visible patients among `ids`, in `ids` order (`getMany` returns no particular order). */
  private async patientsIn(ids: readonly string[]): Promise<ExportPatient[]> {
    const found = new Map(
      (await this.patients.getMany(ids)).map((patient) => [patient.id, patient]),
    );
    return ids.flatMap((id) => {
      const patient = found.get(id);
      return patient ? [patient] : [];
    });
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

  /**
   * Adds the display names of the batch's dentists not seen in an earlier batch, through
   * `UsersService.practitionersByIds` — a building block with no permission check of its own
   * (every system role holds `user:read`, which the Patients screen's dentist names need anyway).
   */
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
