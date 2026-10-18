import type {
  ImportPatientRow,
  ImportPatientsRequest,
  ImportResult,
  ImportRowResult,
  ImportServiceRow,
  ImportServicesRequest,
  ImportVisitRow,
  ImportVisitsRequest,
} from '@dcm/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { DomainError } from '../../../platform/kernel/domain-error';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import { BillingService } from '../../billing';
import { CatalogService, VisitImportService } from '../../clinical';
import { MedicalOptionsService, PatientsService } from '../../patients';

/** What one row did: a record created, or one a previous run already created. */
interface RowOutcome {
  status: 'created' | 'exists';
  id: string;
}

/** Thrown at the end of a dry-run row so its transaction rolls back, carrying what it did. */
class DryRunRollback extends Error {
  constructor(readonly outcome: RowOutcome) {
    super('dry run');
  }
}

/** A row refused before any write (its patient is unknown): reported like a domain error. */
class ImportRowError extends DomainError {
  readonly kind = 'invalid';
  constructor(
    readonly code: string,
    message: string,
    readonly path: string,
  ) {
    super(message);
  }
}

/**
 * The import APIs (feature 6, ADR-0053): rows from a previous system written through the owning
 * modules' services — `patients`, `billing` (opening balances), `clinical` (the catalog and
 * imported visits). Each row runs in its own transaction and answers on its own (`created`,
 * `exists` when a previous run imported it, `failed` with its issues); a failing row rolls back
 * alone. `dryRun` runs each row and rolls it back. Every call needs `import:run`; the services
 * re-check their own permissions.
 */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly patients: PatientsService,
    private readonly medicalOptions: MedicalOptionsService,
    private readonly billing: BillingService,
    private readonly catalog: CatalogService,
    private readonly visits: VisitImportService,
  ) {}

  /** New catalog services; a code the clinic already has is left as it is (`exists`). */
  importServices(request: ImportServicesRequest): Promise<ImportResult> {
    return this.each(
      request,
      (row) => row.code,
      (row) => this.service(row),
    );
  }

  /** Patients by their external id, with their opening balance, archived when they come so. */
  importPatients(request: ImportPatientsRequest): Promise<ImportResult> {
    return this.each(
      request,
      (row) => row.externalId,
      (row) => this.patient(row),
    );
  }

  /** Completed visits, never charged (the opening balance holds the money, ADR-0053). */
  importVisits(request: ImportVisitsRequest): Promise<ImportResult> {
    return this.each(
      request,
      (row) => row.externalId,
      (row) => this.visit(row),
    );
  }

  private async service(row: ImportServiceRow): Promise<RowOutcome> {
    const existing = (await this.catalog.listServices()).find((item) => item.code === row.code);
    if (existing) return { status: 'exists', id: existing.id };
    const saved = await this.catalog.saveServices({ items: [row] });
    const created = saved.find((item) => item.code === row.code);
    if (!created) throw new Error(`import: service ${row.code} was not saved`);
    return { status: 'created', id: created.id };
  }

  private async patient(row: ImportPatientRow): Promise<RowOutcome> {
    const existing = (await this.patients.idsByExternalId([row.externalId])).get(row.externalId);
    if (existing) return { status: 'exists', id: existing };
    // Names differing in case are one option: each id once.
    const allergyIds = new Set<string>();
    for (const name of row.allergies) {
      allergyIds.add((await this.medicalOptions.add({ kind: 'allergy', name })).id);
    }
    const patient = await this.patients.create(
      {
        fullName: row.fullName,
        phone: row.phone,
        dateOfBirth: row.dateOfBirth,
        sex: row.sex,
        email: row.email,
        address: row.address,
        insurance: null,
        medicalHistory: {
          noKnownAllergies: false,
          allergyIds: [...allergyIds],
          noConditions: false,
          conditionIds: [],
          medication: row.medication,
        },
        firstVisitType: null,
        primaryDentistId: null,
        notes: row.notes,
        contacts: [],
      },
      { externalId: row.externalId },
    );
    if (row.openingBalance) {
      await this.billing.recordOpeningBalance(patient.id, row.openingBalance);
    }
    if (row.status === 'archived') {
      await this.patients.archive({ ids: [patient.id], reason: 'Imported as archived' });
    }
    return { status: 'created', id: patient.id };
  }

  private async visit(row: ImportVisitRow): Promise<RowOutcome> {
    const { patientExternalId, ...visit } = row;
    const patientId = (await this.patients.idsByExternalId([patientExternalId])).get(
      patientExternalId,
    );
    if (!patientId) {
      throw new ImportRowError(
        'import.unknown_patient',
        `No patient was imported as ${patientExternalId}`,
        'patientExternalId',
      );
    }
    const result = await this.visits.importVisit({ ...visit, patientId });
    return { status: result.created ? 'created' : 'exists', id: result.visitId };
  }

  /** Runs `work` for each row in its own transaction, rolled back on a dry run. */
  private async each<TRow>(
    request: { dryRun: boolean; rows: readonly TRow[] },
    refOf: (row: TRow) => string,
    work: (row: TRow) => Promise<RowOutcome>,
  ): Promise<ImportResult> {
    this.context.requirePermission('import:run');
    const results: ImportRowResult[] = [];
    for (const row of request.rows) {
      const ref = refOf(row);
      try {
        const outcome = await this.tenantDb.run(async () => {
          const done = await work(row);
          if (request.dryRun) throw new DryRunRollback(done);
          return done;
        });
        results.push({ ref, ...outcome, issues: [] });
      } catch (error) {
        if (error instanceof DryRunRollback) {
          // A dry run's created record is rolled back with its id: there is none to report.
          const { status, id } = error.outcome;
          results.push({ ref, status, id: status === 'exists' ? id : null, issues: [] });
        } else {
          results.push({ ref, status: 'failed', id: null, issues: this.issuesOf(error, ref) });
        }
      }
    }
    return { dryRun: request.dryRun, results };
  }

  private issuesOf(error: unknown, ref: string): ImportRowResult['issues'] {
    if (error instanceof ValidationFailedError) {
      return error.issues.map(({ path, code, message }) => ({ path, code, message }));
    }
    if (error instanceof ImportRowError) {
      return [{ code: error.code, message: error.message, path: error.path }];
    }
    if (error instanceof DomainError) {
      return [{ code: error.code, message: error.message, path: null }];
    }
    // Not a rule the row broke: logged by its reference, reported without the error's text.
    this.logger.error({ err: error, ref }, 'import row failed unexpectedly');
    return [{ code: 'unexpected', message: 'Unexpected error; see the server log', path: null }];
  }
}
