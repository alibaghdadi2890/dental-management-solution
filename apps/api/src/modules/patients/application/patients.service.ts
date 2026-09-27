import {
  ageBandBounds,
  normalizePhone,
  type DuplicateCheckQuery,
  type DuplicateGroup,
  type Patient,
  type PatientArchive,
  type PatientCounts,
  type PatientInput,
  type PatientListItem,
  type PatientListQuery,
  type PatientMerge,
  type PatientPage,
  type PatientPatch,
  type PatientRestore,
  type Tenant,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate } from '../../../platform/kernel/local-date';
import {
  type ValidationIssue,
  ValidationFailedError,
} from '../../../platform/kernel/validation-failed.error';
import { AuditService } from '../../audit';
import { TenancyService } from '../../tenancy';
import { UsersService } from '../../users';
import { formatDisplayNumber } from '../domain/display-number';
import { groupDuplicates } from '../domain/duplicates';
import { type MergePatch, resolveMerge } from '../domain/merge';
import type { DomainPatient } from '../domain/patient';
import {
  MergeSameError,
  PatientArchivedError,
  PatientMergedError,
  PatientNotFoundError,
  UnknownDentistError,
} from '../domain/patient-errors';
import {
  PATIENT_ARCHIVED,
  PATIENT_CREATED,
  PATIENT_RESTORED,
  PATIENT_UPDATED,
  PATIENTS_MERGED,
  type PatientArchived,
  type PatientCreated,
  type PatientRestored,
  type PatientsMerged,
  type PatientUpdated,
} from '../events/patient-events';
import { PatientCountersRepository } from '../persistence/patient-counters.repository';
import {
  type NormalizedPhoneInput,
  type PatientPatch as PatientRecordPatch,
  type PatientRank,
  type PatientSearchFilters,
  PatientsRepository,
} from '../persistence/patients.repository';

/**
 * Options only other modules' services pass — never reachable over HTTP (design Q5, Q7). `billing`
 * composes the views that need balances with them.
 */
export interface PatientSearchInternal {
  /**
   * Restricts the page to these patients (an empty list matches nothing). Required for
   * `view=owing`, which is then read as the active view restricted to these ids.
   */
  idsIn?: readonly string[];
  /**
   * Patient ids in the caller's order; unlisted patients sort at `restAt` (1-based positions, so
   * `ids.length + 1` puts them last and `0` first). The caller encodes the direction; `dir` is
   * ignored. Required for `sort=balance`, and used for nothing else.
   */
  rank?: { ids: readonly string[]; restAt: number };
  /** Overrides `query.size` (1–500), for paging through a whole view (billing's CSV export). */
  size?: number;
}

const MAX_INTERNAL_PAGE_SIZE = 500;

/** The editable fields every write re-checks against the tenant (country, time zone). */
interface TenantCheckedFields {
  phone?: string | undefined;
  guardianPhone?: string | null | undefined;
  dateOfBirth?: string | null | undefined;
}

interface NormalizedFields {
  phone?: NormalizedPhoneInput;
  guardianPhone?: string | null;
}

/** Patch fields stored as given (no normalisation, plain equality). */
const PLAIN_FIELDS = [
  'fullName',
  'dateOfBirth',
  'sex',
  'email',
  'address',
  'insurance',
  'emergencyContact',
  'primaryDentistUserId',
  'notes',
  'guardianName',
  'externalId',
] as const satisfies readonly (keyof PatientPatch & keyof PatientRecordPatch)[];

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

function toPatient(patient: DomainPatient): Patient {
  return {
    id: patient.id,
    displayNumber: patient.displayNumber,
    fullName: patient.fullName,
    phone: patient.phone,
    dateOfBirth: patient.dateOfBirth,
    sex: patient.sex,
    email: patient.email,
    address: patient.address,
    insurance: patient.insurance,
    emergencyContact: patient.emergencyContact,
    medicalAlerts: patient.medicalAlerts,
    primaryDentistUserId: patient.primaryDentistUserId,
    notes: patient.notes,
    guardianName: patient.guardianName,
    guardianPhone: patient.guardianPhone,
    externalId: patient.externalId,
    archivedAt: patient.deletedAt?.toISOString() ?? null,
    mergedIntoId: patient.mergedIntoId,
    createdAt: patient.createdAt.toISOString(),
    updatedAt: patient.updatedAt.toISOString(),
  };
}

function toListItem(patient: DomainPatient): PatientListItem {
  return {
    id: patient.id,
    displayNumber: patient.displayNumber,
    fullName: patient.fullName,
    phone: patient.phone,
    dateOfBirth: patient.dateOfBirth,
    sex: patient.sex,
    medicalAlerts: patient.medicalAlerts,
    primaryDentistUserId: patient.primaryDentistUserId,
    email: patient.email,
    archivedAt: patient.deletedAt?.toISOString() ?? null,
    updatedAt: patient.updatedAt.toISOString(),
  };
}

/**
 * Patient records of the current tenant (docs/modules/patients.md). Phones are normalised against
 * the tenant country and dates of birth checked against the tenant's today; every mutation
 * re-checks `patient:write`, is audited in the same transaction and emits its event after commit.
 */
@Injectable()
export class PatientsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
    private readonly users: UsersService,
    private readonly patients: PatientsRepository,
    private readonly counters: PatientCountersRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // --- Records ---

  /** Mints the next display number in the same transaction, so a failed create frees it. */
  async create(input: PatientInput): Promise<Patient> {
    this.context.requirePermission('patient:write');
    return this.tenantDb.run(async () => {
      const tenant = await this.tenancy.currentTenant();
      const normalized = this.checkFields(input, tenant);
      if (!normalized.phone) throw new Error('create: phone was not normalised');
      if (input.primaryDentistUserId !== null) {
        await this.assertActiveDentist(input.primaryDentistUserId);
      }
      const displayNumber = formatDisplayNumber(await this.counters.nextValue());
      const created = toPatient(
        await this.patients.insert({
          displayNumber,
          fullName: input.fullName,
          phone: normalized.phone,
          dateOfBirth: input.dateOfBirth,
          sex: input.sex,
          email: input.email,
          address: input.address,
          insurance: input.insurance,
          emergencyContact: input.emergencyContact,
          notes: input.notes,
          medicalAlerts: input.medicalAlerts,
          primaryDentistUserId: input.primaryDentistUserId,
          guardianName: input.guardianName,
          guardianPhone: normalized.guardianPhone ?? null,
          externalId: input.externalId,
        }),
      );
      await this.audit.record({
        action: 'patient.create',
        resourceType: 'patient',
        resourceId: created.id,
        after: created,
      });
      const event: PatientCreated = this.events.create(PATIENT_CREATED, { patientId: created.id });
      await this.events.publish(event);
      return created;
    });
  }

  /**
   * Changes only the fields whose stored value differs; a patch that changes nothing writes,
   * audits and emits nothing. A dentist kept from before may be inactive; a newly chosen one must
   * be an active practitioner.
   */
  async update(id: string, patch: PatientPatch): Promise<Patient> {
    this.context.requirePermission('patient:write');
    return this.tenantDb.run(async () => {
      const before = await this.patients.findForUpdate(id);
      if (!before) throw new PatientNotFoundError('Patient not found');
      if (before.deletedAt !== null) {
        throw new PatientArchivedError('Archived patients cannot be edited; restore them first');
      }
      const tenant = await this.tenancy.currentTenant();
      const normalized = this.checkFields(patch, tenant);
      const dentist = patch.primaryDentistUserId;
      if (dentist !== undefined && dentist !== null && dentist !== before.primaryDentistUserId) {
        await this.assertActiveDentist(dentist);
      }

      const { set, fields } = changesOf(before, patch, normalized);
      if (fields.length === 0) return toPatient(before);

      const updated = await this.patients.update(id, set);
      if (!updated) throw new PatientNotFoundError('Patient not found');
      const after = toPatient(updated);
      await this.audit.record({
        action: 'patient.update',
        resourceType: 'patient',
        resourceId: id,
        before: toPatient(before),
        after,
      });
      const event: PatientUpdated = this.events.create(PATIENT_UPDATED, { patientId: id, fields });
      await this.events.publish(event);
      return after;
    });
  }

  /** Archived and merged-away records included. */
  async get(id: string): Promise<Patient> {
    this.context.requirePermission('patient:read');
    const patient = await this.patients.findById(id);
    if (!patient) throw new PatientNotFoundError('Patient not found');
    return toPatient(patient);
  }

  /**
   * Building block for other modules' services, which guard their own use (e.g. `billing`'s
   * existence checks and export rows): the patients among `ids` visible to the tenant, archived
   * ones included, in no particular order. Unknown ids are simply absent.
   */
  async getMany(ids: readonly string[]): Promise<Patient[]> {
    return (await this.patients.findByIds(ids)).map(toPatient);
  }

  // --- The Patients list ---

  /**
   * An offset page (ADR-0018). `view=owing` and `sort=balance` need `internal` options that only
   * `billing` supplies; without them they are refused as `validation_failed`.
   */
  async search(
    query: PatientListQuery,
    internal: PatientSearchInternal = {},
  ): Promise<PatientPage> {
    this.context.requirePermission('patient:read');
    if (query.view === 'owing' && internal.idsIn === undefined) {
      throw unsupported('view', 'The owing view is served by billing');
    }
    if (query.sort === 'balance' && internal.rank === undefined) {
      throw unsupported('sort', 'Sorting by balance is served by billing');
    }
    const size = internal.size ?? query.size;
    if (!Number.isInteger(size) || size < 1 || size > MAX_INTERNAL_PAGE_SIZE) {
      throw new RangeError(`search: page size must be 1–${MAX_INTERNAL_PAGE_SIZE}`);
    }
    return this.tenantDb.run(async () => {
      const filters = await this.filtersFor(query);
      const rank = await this.rankFor(query, internal);
      const { rows, total } = await this.patients.search(filters, {
        page: query.page,
        size,
        sort: query.sort,
        dir: query.dir,
        ...(internal.idsIn === undefined ? {} : { idsIn: internal.idsIn }),
        ...(rank === undefined ? {} : { rank }),
      });
      return { items: rows.map(toListItem), total, page: query.page, size };
    });
  }

  /** The tab chips; `notSeen` equals `active` until visits exist (design Q14). */
  async counts(): Promise<PatientCounts> {
    this.context.requirePermission('patient:read');
    const { active, archived } = await this.patients.counts();
    return { active, notSeen: active, archived };
  }

  /** Groups of active patients sharing a name (diacritics-insensitive) and a date of birth. */
  async duplicates(): Promise<DuplicateGroup[]> {
    this.context.requirePermission('patient:read');
    const groups = groupDuplicates(await this.patients.duplicateRows());
    return groups.map((group) => ({ patients: group.map(toListItem) }));
  }

  /** The create/edit panel's warning: active patients with this name and date of birth. */
  async checkDuplicates(query: DuplicateCheckQuery): Promise<PatientListItem[]> {
    this.context.requirePermission('patient:read');
    const twins = await this.patients.findTwins(query.fullName, query.dateOfBirth, query.excludeId);
    return twins.map(toListItem);
  }

  // --- Archive, restore, merge ---

  /**
   * All-or-nothing: an id the tenant can't see fails the whole call with 404. Already archived ids
   * are no-ops. Returns the patients this call archived (the ones an undo should restore).
   */
  async archive(input: PatientArchive): Promise<Patient[]> {
    this.context.requirePermission('patient:write');
    return this.tenantDb.run(async () => {
      const before = await this.requireAll(input.ids);
      const archived = await this.patients.setArchived(input.ids, this.clock.now());
      return this.recordEach(before, archived, 'patient.archive', input.reason, (patientId) => {
        const event: PatientArchived = this.events.create(PATIENT_ARCHIVED, { patientId });
        return event;
      });
    });
  }

  /**
   * All-or-nothing like `archive`; a merged-away id refuses the call (409 `patient.merged`).
   * Already active ids are no-ops. Returns the patients this call restored.
   */
  async restore(input: PatientRestore): Promise<Patient[]> {
    this.context.requirePermission('patient:write');
    return this.tenantDb.run(async () => {
      const before = await this.requireAll(input.ids);
      const merged = before.find((patient) => patient.mergedIntoId !== null);
      if (merged) {
        throw new PatientMergedError(
          `${merged.displayNumber} was merged into another record and cannot be restored`,
        );
      }
      const restored = await this.patients.setArchived(input.ids, null);
      return this.recordEach(before, restored, 'patient.restore', null, (patientId) => {
        const event: PatientRestored = this.events.create(PATIENT_RESTORED, { patientId });
        return event;
      });
    });
  }

  /**
   * One transaction with both rows locked in id order (no deadlock between overlapping merges).
   * The kept record takes the chosen fields and the union of alerts; the dropped one is archived
   * with `mergedIntoId`. Returns the kept record.
   */
  async merge(input: PatientMerge): Promise<Patient> {
    this.context.requirePermission('patient:write');
    if (input.keepId === input.dropId) {
      throw new MergeSameError('A patient cannot be merged into itself');
    }
    return this.tenantDb.run(async () => {
      const { a: kept, b: dropped } = await this.patients.lockPair(input.keepId, input.dropId);
      if (kept.deletedAt !== null || dropped.deletedAt !== null) {
        throw new PatientArchivedError('Archived patients cannot be merged; restore them first');
      }
      const { patch } = resolveMerge(kept, dropped, input.fieldChoices);
      const { country } = await this.tenancy.currentTenant();
      const set = mergeSet(patch, country);
      const keptAfter =
        Object.keys(set).length === 0 ? kept : await this.patients.update(kept.id, set);
      if (!keptAfter) throw new PatientNotFoundError('Patient not found');
      await this.patients.markMerged(dropped.id, kept.id, this.clock.now());

      const after = toPatient(keptAfter);
      await this.audit.record({
        action: 'patient.merge',
        resourceType: 'patient',
        resourceId: kept.id,
        before: { kept: toPatient(kept), dropped: toPatient(dropped) },
        after,
        reason: input.reason,
      });
      const event: PatientsMerged = this.events.create(PATIENTS_MERGED, {
        keptId: kept.id,
        droppedId: dropped.id,
      });
      await this.events.publish(event);
      return after;
    });
  }

  // --- Shared rules ---

  /**
   * Normalises `phone`/`guardianPhone` against the tenant country and checks that the date of
   * birth is not after the tenant's today (the contract only knows UTC, with a day of tolerance).
   * Every failure is reported at once as 422 `validation_failed`, addressed by field.
   */
  private checkFields(fields: TenantCheckedFields, tenant: Tenant): NormalizedFields {
    const issues: ValidationIssue[] = [];
    const normalized: NormalizedFields = {};
    if (fields.phone !== undefined) {
      const phone = normalizePhone(fields.phone, tenant.country);
      if (phone) normalized.phone = phone;
      else issues.push(invalidPhone('phone'));
    }
    if (fields.guardianPhone === null) {
      normalized.guardianPhone = null;
    } else if (fields.guardianPhone !== undefined) {
      const guardianPhone = normalizePhone(fields.guardianPhone, tenant.country);
      if (guardianPhone) normalized.guardianPhone = guardianPhone.e164;
      else issues.push(invalidPhone('guardianPhone'));
    }
    if (fields.dateOfBirth && fields.dateOfBirth > this.today(tenant)) {
      issues.push({
        path: 'dateOfBirth',
        code: 'future_date',
        message: 'Date of birth cannot be in the future',
      });
    }
    if (issues.length > 0) {
      throw new ValidationFailedError(
        issues.length === 1 ? '1 field is invalid' : `${issues.length} fields are invalid`,
        issues,
      );
    }
    return normalized;
  }

  private async assertActiveDentist(userId: string): Promise<void> {
    const practitioners = await this.users.listPractitioners();
    if (!practitioners.some((practitioner) => practitioner.userId === userId)) {
      throw new UnknownDentistError('The primary dentist is not an active dentist of this clinic');
    }
  }

  /** The tenant's calendar date now (CLAUDE.md §5: local-time logic uses the tenant time zone). */
  private today(tenant: Tenant): string {
    return localDate(this.clock.now(), tenant.timeZone);
  }

  private async filtersFor(query: PatientListQuery): Promise<PatientSearchFilters> {
    const filters: PatientSearchFilters = {
      view: query.view === 'owing' ? 'active' : query.view,
    };
    if (query.q !== undefined) filters.q = query.q;
    if (query.dentist !== undefined) filters.dentist = query.dentist;
    if (query.alerts !== undefined) filters.alerts = query.alerts;
    if (query.age !== undefined) {
      const bounds = ageBandBounds(query.age, this.today(await this.tenancy.currentTenant()));
      if (bounds.after !== undefined) filters.dobAfter = bounds.after;
      if (bounds.onOrBefore !== undefined) filters.dobOnOrBefore = bounds.onOrBefore;
    }
    // `lastVisit`: nobody has visits before feature 4, so "any" and "never" both match everyone.
    return filters;
  }

  /**
   * `sort=dentist`: every dentist assigned to a patient (inactive ones too), in the practitioner
   * display-name order of `users`; reversed for `desc`. Patients without a dentist come last in
   * both directions. `sort=balance`: the caller's rank over patient ids.
   */
  private async rankFor(
    query: PatientListQuery,
    internal: PatientSearchInternal,
  ): Promise<PatientRank | undefined> {
    if (query.sort === 'balance' && internal.rank) {
      return { column: 'id', ids: internal.rank.ids, restAt: internal.rank.restAt };
    }
    if (query.sort !== 'dentist') return undefined;
    const dentists = await this.users.practitionersByIds(await this.patients.assignedDentistIds());
    const ids = dentists.map((dentist) => dentist.userId);
    if (query.dir === 'desc') ids.reverse();
    return { column: 'primaryDentistUserId', ids, restAt: ids.length + 1 };
  }

  /** Every id must be visible to the tenant (404 otherwise, nothing changed). */
  private async requireAll(ids: readonly string[]): Promise<DomainPatient[]> {
    const found = await this.patients.findByIds(ids);
    if (found.length !== new Set(ids).size) throw new PatientNotFoundError('Patient not found');
    return found;
  }

  /** One audit entry and one event per patient `changedIds` names, in `changedIds` order. */
  private async recordEach(
    before: readonly DomainPatient[],
    changedIds: readonly string[],
    action: string,
    reason: string | null,
    eventFor: (patientId: string) => PatientArchived | PatientRestored,
  ): Promise<Patient[]> {
    const beforeById = new Map(before.map((patient) => [patient.id, patient]));
    const afterById = new Map(
      (await this.patients.findByIds(changedIds)).map((patient) => [patient.id, patient]),
    );
    const changed: Patient[] = [];
    for (const id of changedIds) {
      const previous = beforeById.get(id);
      const current = afterById.get(id);
      if (!previous || !current) throw new PatientNotFoundError('Patient not found');
      const after = toPatient(current);
      await this.audit.record({
        action,
        resourceType: 'patient',
        resourceId: id,
        before: toPatient(previous),
        after,
        reason: reason ?? undefined,
      });
      await this.events.publish(eventFor(id));
      changed.push(after);
    }
    return changed;
  }
}

function invalidPhone(path: 'phone' | 'guardianPhone'): ValidationIssue {
  return { path, code: 'invalid_phone', message: 'Not a valid phone number' };
}

function unsupported(path: 'view' | 'sort', message: string): ValidationFailedError {
  return new ValidationFailedError(message, [{ path, code: 'unsupported', message }]);
}

/** The repository patch for the fields of `patch` whose stored value changes, and their names. */
function changesOf(
  before: DomainPatient,
  patch: PatientPatch,
  normalized: NormalizedFields,
): { set: PatientRecordPatch; fields: string[] } {
  const set: PatientRecordPatch = {};
  const fields: string[] = [];
  if (normalized.phone && normalized.phone.e164 !== before.phone) {
    set.phone = normalized.phone;
    fields.push('phone');
  }
  for (const field of PLAIN_FIELDS) {
    const value = patch[field];
    if (value === undefined || value === before[field]) continue;
    Object.assign(set, { [field]: value });
    fields.push(field);
  }
  if (patch.medicalAlerts && !sameList(patch.medicalAlerts, before.medicalAlerts)) {
    set.medicalAlerts = patch.medicalAlerts;
    fields.push('medicalAlerts');
  }
  if (normalized.guardianPhone !== undefined && normalized.guardianPhone !== before.guardianPhone) {
    set.guardianPhone = normalized.guardianPhone;
    fields.push('guardianPhone');
  }
  return { set, fields };
}

/**
 * The merge patch as a repository patch. A stored phone is E.164 (leading `+`), so re-parsing it
 * yields the same number whatever the country; it is only needed for the national search digits.
 */
function mergeSet(patch: MergePatch, country: Tenant['country']): PatientRecordPatch {
  const { phone, ...rest } = patch;
  if (phone === undefined) return rest;
  const normalized = normalizePhone(phone, country);
  if (!normalized) throw new Error('merge: a stored phone is not a valid E.164 number');
  return { ...rest, phone: normalized };
}
