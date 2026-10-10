import {
  type CatalogKind,
  type CatalogSeedResult,
  type DiagnosisBatch,
  type DiagnosisItem,
  type DiagnosisItemInput,
  leastUsedMarkColor,
  MARK_PRIORITY_DEFAULT,
  type MarkColor,
  type ServiceBatch,
  type ServiceItem,
  type ServiceItemInput,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import { newId } from '../../../platform/kernel/id';
import { AuditService } from '../../audit';
import { TenancyService } from '../../tenancy';
import { assertUniqueCodes } from '../domain/catalog-batch';
import { CatalogItemInUseError, CatalogItemNotFoundError } from '../domain/catalog-errors';
import { DEFAULT_DIAGNOSES, DEFAULT_SERVICES } from '../domain/default-catalog';
import { CATALOG_CHANGED, type CatalogChanged } from '../events/catalog-changed';
import type { CatalogRowLock, CatalogStore } from '../persistence/catalog-store';
import { DiagnosesRepository } from '../persistence/diagnoses.repository';
import { ProceduresRepository } from '../persistence/procedures.repository';

type CatalogItem = ServiceItem | DiagnosisItem;

/** How one catalog is stored and audited; the two catalogs share every rule. */
interface Catalog<TItem extends CatalogItem> {
  kind: CatalogKind;
  resourceType: 'procedure' | 'diagnosis';
  store: CatalogStore<TItem>;
}

const sameRow = (a: CatalogItem, b: CatalogItem) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Hands out the chart colour of rows that have none (feature 9): the key the catalog uses least,
 * counting the ones already handed out in this batch.
 */
function colorPicker(): (stored: readonly { color: MarkColor | null }[]) => MarkColor {
  const given: MarkColor[] = [];
  return (stored) => {
    const color = leastUsedMarkColor([...stored.map((item) => item.color), ...given]);
    given.push(color);
    return color;
  };
}

/**
 * The per-tenant service and diagnosis catalogs (docs/modules/clinical.md). Writes need
 * `catalog:write` and are audited per row in the same transaction; each emits `CatalogChanged`.
 * Service prices are money in the tenant currency at the time they were set (ADR-0015).
 */
@Injectable()
export class CatalogService {
  private readonly services: Catalog<ServiceItem>;
  private readonly diagnoses: Catalog<DiagnosisItem>;

  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
    procedures: ProceduresRepository,
    diagnoses: DiagnosesRepository,
  ) {
    this.services = { kind: 'service', resourceType: 'procedure', store: procedures };
    this.diagnoses = { kind: 'diagnosis', resourceType: 'diagnosis', store: diagnoses };
  }

  // --- The Catalog screen ---

  /** Every live row, active or not (the screen filters); a small reference list. */
  listServices(): Promise<ServiceItem[]> {
    this.context.requirePermission('catalog:read');
    return this.services.store.list();
  }

  listDiagnoses(): Promise<DiagnosisItem[]> {
    this.context.requirePermission('catalog:read');
    return this.diagnoses.store.list();
  }

  /**
   * The save bar's batch: new rows (no id) and whole changed rows, in one transaction. A price
   * takes the tenant's current currency when it is created or changed. Returns the catalog.
   *
   * Chart marks (feature 9): a mark field that is not sent keeps its stored value; a per-tooth
   * service left without a colour gets the least used one. For a service on a jaw or the mouth
   * what is sent is ignored: a new one has no mark, and one moved off the tooth keeps the mark it
   * had, which its earlier tooth records are still drawn with.
   */
  async saveServices(batch: ServiceBatch): Promise<ServiceItem[]> {
    this.context.requirePermission('catalog:write');
    return this.tenantDb.run(async () => {
      const { currency } = await this.tenancy.currentTenant();
      const pickColor = colorPicker();
      return this.saveBatch(
        this.services,
        batch.items,
        (row: ServiceItemInput, id, before, stored): ServiceItem => {
          const perTooth = row.chargeUnit === 'per_tooth';
          return {
            id,
            code: row.code,
            name: row.name,
            category: row.category,
            chargeUnit: row.chargeUnit,
            price:
              before && Number(before.price.amount) === Number(row.price)
                ? before.price
                : { amount: row.price, currency },
            frequent: row.frequent,
            active: row.active,
            toothEffect: row.toothEffect,
            color: perTooth
              ? (row.color ?? before?.color ?? pickColor(stored))
              : (before?.color ?? null),
            icon: perTooth && row.icon !== undefined ? row.icon : (before?.icon ?? null),
            markPriority: row.markPriority ?? before?.markPriority ?? MARK_PRIORITY_DEFAULT,
          };
        },
      );
    });
  }

  async saveDiagnoses(batch: DiagnosisBatch): Promise<DiagnosisItem[]> {
    this.context.requirePermission('catalog:write');
    const pickColor = colorPicker();
    return this.tenantDb.run(() =>
      this.saveBatch(
        this.diagnoses,
        batch.items,
        (row: DiagnosisItemInput, id, before, stored): DiagnosisItem => ({
          id,
          code: row.code,
          name: row.name,
          category: row.category,
          frequent: row.frequent,
          active: row.active,
          color: row.color ?? before?.color ?? pickColor(stored),
          markPriority: row.markPriority ?? before?.markPriority ?? MARK_PRIORITY_DEFAULT,
        }),
      ),
    );
  }

  deleteService(id: string): Promise<void> {
    return this.remove(this.services, id);
  }

  deleteDiagnosis(id: string): Promise<void> {
    return this.remove(this.diagnoses, id);
  }

  /** "Mark inactive" from the delete dialog: the row stays on past visits (C5). */
  deactivateService(id: string): Promise<ServiceItem> {
    return this.deactivate(this.services, id);
  }

  deactivateDiagnosis(id: string): Promise<DiagnosisItem> {
    return this.deactivate(this.diagnoses, id);
  }

  /**
   * Fills a tenant whose catalogs are both empty with the default template (C3); a no-op
   * otherwise. Rows are inserted only where their code is free, so concurrent calls (the
   * provisioning subscriber and the admin's button) cannot duplicate them.
   */
  async seedDefaultCatalog(): Promise<CatalogSeedResult> {
    this.context.requirePermission('catalog:write');
    return this.tenantDb.run(async () => {
      const services = await this.services.store.countLive();
      const diagnoses = await this.diagnoses.store.countLive();
      if (services > 0 || diagnoses > 0) {
        return { services: 0, diagnoses: 0 };
      }
      const { currency } = await this.tenancy.currentTenant();
      const createdServices = await this.services.store.insertIfAbsent(
        DEFAULT_SERVICES.map(({ price, ...row }) => ({
          ...row,
          id: newId(),
          price: { amount: price, currency },
          markPriority: MARK_PRIORITY_DEFAULT,
        })),
      );
      const createdDiagnoses = await this.diagnoses.store.insertIfAbsent(
        DEFAULT_DIAGNOSES.map((row) => ({
          ...row,
          id: newId(),
          markPriority: MARK_PRIORITY_DEFAULT,
        })),
      );
      await this.recorded(
        this.services,
        createdServices.map((after) => ({ after })),
      );
      await this.recorded(
        this.diagnoses,
        createdDiagnoses.map((after) => ({ after })),
      );
      return { services: createdServices.length, diagnoses: createdDiagnoses.length };
    });
  }

  // --- Building blocks for the visit workspace and pricing (C8); callers guard their use ---

  async listActiveServices(): Promise<ServiceItem[]> {
    return (await this.services.store.list()).filter((item) => item.active);
  }

  async listActiveDiagnoses(): Promise<DiagnosisItem[]> {
    return (await this.diagnoses.store.list()).filter((item) => item.active);
  }

  /**
   * A live row, active or not, for a record about to refer to it: read `FOR KEY SHARE` in the
   * caller's open transaction (throws when none is open), so a concurrent delete can't pass its
   * in-use check before the record commits (`CatalogRowLock`).
   */
  getServiceForRecord(id: string): Promise<ServiceItem> {
    return this.requireForRecord(this.services, id);
  }

  getDiagnosisForRecord(id: string): Promise<DiagnosisItem> {
    return this.requireForRecord(this.diagnoses, id);
  }

  // --- Shared rules ---

  private async saveBatch<TItem extends CatalogItem, TInput extends { id?: string | undefined }>(
    catalog: Catalog<TItem>,
    rows: readonly TInput[],
    build: (row: TInput, id: string, before: TItem | undefined, stored: readonly TItem[]) => TItem,
  ): Promise<TItem[]> {
    const stored = await catalog.store.list();
    const byId = new Map(stored.map((item) => [item.id, item]));
    const changes = rows.map((row) => {
      if (row.id === undefined) {
        return build(row, newId(), undefined, stored);
      }
      const before = byId.get(row.id);
      if (!before) {
        throw new CatalogItemNotFoundError('Catalog row not found');
      }
      return build(row, row.id, before, stored);
    });

    assertUniqueCodes(stored, changes);
    await catalog.store.save(changes, new Set(byId.keys()));

    const saved = await catalog.store.list();
    const savedById = new Map(saved.map((item) => [item.id, item]));
    await this.recorded(
      catalog,
      changes.flatMap((change) => {
        const after = savedById.get(change.id);
        const before = byId.get(change.id);
        return after && !(before && sameRow(before, after)) ? [{ before, after }] : [];
      }),
    );
    return saved;
  }

  private async remove<TItem extends CatalogItem>(
    catalog: Catalog<TItem>,
    id: string,
  ): Promise<void> {
    this.context.requirePermission('catalog:write');
    await this.tenantDb.run(async () => {
      // Locked first, so no record can start referring to it before the check (`CatalogRowLock`).
      const before = await this.require(catalog, id, 'update');
      // A row a record refers to stays for that record (C5, V11); it can only be deactivated.
      if (await catalog.store.isInUse(id)) {
        throw new CatalogItemInUseError(
          `${before.name} is used on patient records; mark it inactive`,
        );
      }
      await catalog.store.softDelete(id);
      await this.audit.record({
        action: `catalog.${catalog.kind}.delete`,
        resourceType: catalog.resourceType,
        resourceId: id,
        before,
      });
      await this.publish(catalog.kind, [id]);
    });
  }

  private async deactivate<TItem extends CatalogItem>(
    catalog: Catalog<TItem>,
    id: string,
  ): Promise<TItem> {
    this.context.requirePermission('catalog:write');
    return this.tenantDb.run(async () => {
      const before = await this.require(catalog, id);
      const after = await catalog.store.deactivate(id);
      await this.audit.record({
        action: `catalog.${catalog.kind}.deactivate`,
        resourceType: catalog.resourceType,
        resourceId: id,
        before,
        after,
      });
      await this.publish(catalog.kind, [id]);
      return after;
    });
  }

  private async require<TItem extends CatalogItem>(
    catalog: Catalog<TItem>,
    id: string,
    lock?: CatalogRowLock,
  ): Promise<TItem> {
    const item = await catalog.store.byId(id, lock);
    if (!item) {
      throw new CatalogItemNotFoundError('Catalog row not found');
    }
    return item;
  }

  private requireForRecord<TItem extends CatalogItem>(
    catalog: Catalog<TItem>,
    id: string,
  ): Promise<TItem> {
    if (!this.tenantDb.currentTransaction()) {
      throw new Error('a catalog row for a record is read inside the record transaction');
    }
    return this.require(catalog, id, 'key share');
  }

  /** One audit entry per created or updated row, then `CatalogChanged` for them all. */
  private async recorded<TItem extends CatalogItem>(
    catalog: Catalog<TItem>,
    changes: readonly { before?: TItem | undefined; after: TItem }[],
  ): Promise<void> {
    if (changes.length === 0) return;
    for (const { before, after } of changes) {
      await this.audit.record({
        action: `catalog.${catalog.kind}.${before ? 'update' : 'create'}`,
        resourceType: catalog.resourceType,
        resourceId: after.id,
        before,
        after,
      });
    }
    await this.publish(
      catalog.kind,
      changes.map((change) => change.after.id),
    );
  }

  private async publish(kind: CatalogKind, ids: string[]): Promise<void> {
    const event: CatalogChanged = this.events.create(CATALOG_CHANGED, { kind, ids });
    await this.events.publish(event);
  }
}
