import {
  MEDICAL_OPTION_KINDS,
  type MedicalOption,
  type MedicalOptionAdd,
  type MedicalOptionBatch,
  medicalOptionKey,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import { AuditService } from '../../audit';
import { DEFAULT_MEDICAL_OPTIONS } from '../domain/medical-history';
import { MedicalOptionInUseError, MedicalOptionNotFoundError } from '../domain/patient-errors';
import { MedicalOptionsRepository } from '../persistence/medical-options.repository';

const OPTION = 'medical_option';
const NOT_FOUND = 'This list item no longer exists';

/**
 * A clinic's allergy and condition lists (docs/modules/patients.md, ADR-0046): what the chips of
 * a patient's medical history offer. Everyone who reads patients reads them, and whoever writes a
 * patient's history may add a name to them (`add`); editing them is the Catalog's, so it needs
 * `catalog:write`. Every write is audited per row.
 */
@Injectable()
export class MedicalOptionsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly options: MedicalOptionsRepository,
  ) {}

  /** Both lists, active and inactive: allergies then conditions, each by name. */
  async list(): Promise<MedicalOption[]> {
    this.context.requirePermission('patient:read');
    return this.options.list();
  }

  /**
   * The option of this name in its list, for a history that is being typed: the one already
   * there, whatever its case, else a new one. An inactive one is offered again, since a patient
   * has it after all. Needs only `patient:write`: recording an allergy cannot wait for whoever
   * edits the Catalog.
   */
  async add(input: MedicalOptionAdd): Promise<MedicalOption> {
    this.context.requirePermission('patient:write');
    return this.tenantDb.run(async () => {
      const [created] = await this.options.insertIfAbsent(input.kind, [input.name]);
      if (created) {
        await this.record('create', created.id, undefined, created);
        return created;
      }
      const found = await this.options.findByName(input.kind, input.name);
      if (!found) throw new MedicalOptionNotFoundError(NOT_FOUND);
      const before = await this.options.lock(found.id);
      if (!before) throw new MedicalOptionNotFoundError(NOT_FOUND);
      if (before.active) return before;
      const after = await this.options.update(before.id, { active: true });
      await this.record('update', before.id, before, after);
      return after;
    });
  }

  /**
   * Creates the rows without an id and updates the others, in one transaction. A name already in
   * its list, whatever its case → 422 `validation_failed` at `items.<i>.name`; an unknown id →
   * 404. A row's list never changes. Answers with both lists as they now are.
   */
  async save(batch: MedicalOptionBatch): Promise<MedicalOption[]> {
    this.context.requirePermission('catalog:write');
    return this.tenantDb.run(async () => {
      const existing = new Map((await this.options.list()).map((option) => [option.id, option]));
      const sentIds = new Set(batch.items.flatMap((row) => row.id ?? []));
      // Names taken by the rows this batch leaves alone.
      const taken = new Set(
        [...existing.values()].filter(({ id }) => !sentIds.has(id)).map(medicalOptionKey),
      );
      batch.items.forEach((row, index) => {
        if (taken.has(medicalOptionKey(row))) {
          const message = `${row.name} is already in this list`;
          throw new ValidationFailedError(message, [
            { path: `items.${String(index)}.name`, code: 'duplicate', message },
          ]);
        }
      });
      // A name another row of the batch gives up (a swap, a chain) is still taken while the
      // rows are written one by one: such rows leave their name first.
      const changing = batch.items.flatMap((row) => {
        const before = row.id === undefined ? undefined : existing.get(row.id);
        return before && medicalOptionKey(before) !== medicalOptionKey(row) ? [before] : [];
      });
      const givenUp = new Set(changing.map(medicalOptionKey));
      for (const before of changing) {
        const wanted = batch.items.find((row) => row.id === before.id);
        if (wanted && givenUp.has(medicalOptionKey(wanted))) {
          await this.options.update(before.id, {
            name: `moving:${before.id}`,
            active: before.active,
          });
        }
      }
      for (const row of batch.items) {
        if (row.id === undefined) {
          const after = await this.options.insert(row);
          await this.record('create', after.id, undefined, after);
          continue;
        }
        const before = existing.get(row.id);
        if (before?.kind !== row.kind) throw new MedicalOptionNotFoundError(NOT_FOUND);
        if (before.name === row.name && before.active === row.active) continue;
        const after = await this.options.update(row.id, { name: row.name, active: row.active });
        await this.record('update', row.id, before, after);
      }
      return this.options.list();
    });
  }

  /**
   * Removes a row no patient has; one a patient has can only be deactivated (409
   * `medical_option.in_use`). The row is locked first, so a history picking it meanwhile waits.
   */
  async remove(id: string): Promise<void> {
    this.context.requirePermission('catalog:write');
    await this.tenantDb.run(async () => {
      const before = await this.options.lock(id);
      if (!before) throw new MedicalOptionNotFoundError(NOT_FOUND);
      if (await this.options.isInUse(id)) {
        throw new MedicalOptionInUseError(
          `${before.name} is on a patient's history; mark it inactive instead`,
        );
      }
      await this.options.softDelete(id);
      await this.record('delete', id, before, undefined);
    });
  }

  /** "Mark inactive": the row leaves the pickers and stays on the patients who have it. */
  async deactivate(id: string): Promise<MedicalOption> {
    this.context.requirePermission('catalog:write');
    return this.tenantDb.run(async () => {
      const before = await this.options.lock(id);
      if (!before) throw new MedicalOptionNotFoundError(NOT_FOUND);
      if (!before.active) return before;
      const after = await this.options.update(id, { active: false });
      await this.record('deactivate', id, before, after);
      return after;
    });
  }

  /**
   * Fills a tenant that has neither list with the defaults; a no-op otherwise. Names are
   * inserted only where free, so the provisioning subscriber and the Catalog's button cannot
   * duplicate them. Answers with the number of rows created.
   */
  async seedDefaults(): Promise<{ created: number }> {
    this.context.requirePermission('catalog:write');
    return this.tenantDb.run(async () => {
      if ((await this.options.countLive()) > 0) return { created: 0 };
      let created = 0;
      for (const kind of MEDICAL_OPTION_KINDS) {
        const rows = await this.options.insertIfAbsent(kind, DEFAULT_MEDICAL_OPTIONS[kind]);
        for (const after of rows) await this.record('create', after.id, undefined, after);
        created += rows.length;
      }
      return { created };
    });
  }

  private record(
    verb: 'create' | 'update' | 'delete' | 'deactivate',
    id: string,
    before: MedicalOption | undefined,
    after: MedicalOption | undefined,
  ): Promise<void> {
    return this.audit.record({
      action: `${OPTION}.${verb}`,
      resourceType: OPTION,
      resourceId: id,
      before,
      after,
    });
  }
}
