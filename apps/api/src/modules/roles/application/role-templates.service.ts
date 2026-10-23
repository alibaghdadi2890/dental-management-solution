import { randomBytes } from 'node:crypto';
import {
  closeImplied,
  CUSTOM_ROLE_KEY_PREFIX,
  type GrantablePermission,
  type RoleCreate,
  type RoleTemplate,
  type RoleUpdate,
} from '@dcm/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { PlatformAdminDb } from '../../../platform/db/platform-admin-db';
import { TenantDb } from '../../../platform/db/tenant-db';
import { RoleKindError, RoleNotFoundError, UnknownRoleError } from '../domain/roles-errors';
import { RoleTemplatesRepository } from '../persistence/role-templates.repository';

/**
 * The platform's default roles (ADR-0056), managed by platform admins for clinics that would
 * rather not: the system templates are what a clinic's Reset to default restores, and every
 * template is what a new clinic is created with. Existing clinics never change with them.
 * Global data, so writes go through `withoutTenant()` and are logged, not in a clinic's audit.
 */
@Injectable()
export class RoleTemplatesService {
  private readonly logger = new Logger(RoleTemplatesService.name);

  constructor(
    private readonly context: RequestContext,
    private readonly adminDb: PlatformAdminDb,
    private readonly tenantDb: TenantDb,
    private readonly templates: RoleTemplatesRepository,
  ) {}

  list(): Promise<RoleTemplate[]> {
    this.context.requirePermission('platform:admin');
    return this.adminDb.withoutTenant('list role templates', (tx) => this.templates.list(tx));
  }

  /** An extra default role, empty or a copy of another template's permissions. */
  async create(input: RoleCreate): Promise<RoleTemplate> {
    this.context.requirePermission('platform:admin');
    return this.adminDb.withoutTenant('create a role template', async (tx) => {
      let permissions: GrantablePermission[] = [];
      if (input.copyFrom !== undefined) {
        const source = await this.templates.byKey(tx, input.copyFrom);
        if (!source) throw new UnknownRoleError(`Unknown role: ${input.copyFrom}`);
        permissions = source.permissions;
      }
      const id = await this.templates.insert(tx, {
        key: `${CUSTOM_ROLE_KEY_PREFIX}${randomBytes(4).toString('hex')}`,
        name: input.name,
        description: input.description,
        updatedBy: this.context.requireUserId(),
      });
      await this.templates.replacePermissions(tx, id, closeImplied(permissions));
      const created = await this.load(tx, id);
      this.logger.log({ templateId: id, after: created }, 'role template created');
      return created;
    });
  }

  /** A system template keeps its name; its permissions change. Closed under `implies`. */
  async update(id: string, patch: RoleUpdate): Promise<RoleTemplate> {
    this.context.requirePermission('platform:admin');
    return this.adminDb.withoutTenant('update a role template', async (tx) => {
      const before = await this.load(tx, id);
      if (before.system && (patch.name !== undefined || patch.description !== undefined)) {
        throw new RoleKindError('A system role keeps its name');
      }
      await this.templates.update(tx, id, {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
        updatedBy: this.context.requireUserId(),
      });
      if (patch.permissions !== undefined) {
        await this.templates.replacePermissions(tx, id, closeImplied(patch.permissions));
      }
      const after = await this.load(tx, id);
      this.logger.log({ templateId: id, before, after }, 'role template updated');
      return after;
    });
  }

  /** An extra template switched off is not given to new clinics; never deleted. */
  setActive(id: string, active: boolean): Promise<RoleTemplate> {
    this.context.requirePermission('platform:admin');
    return this.adminDb.withoutTenant('switch a role template', async (tx) => {
      const before = await this.load(tx, id);
      if (before.system) throw new RoleKindError('Only an extra default role is switched off');
      if (before.active !== active) {
        await this.templates.update(tx, id, { active, updatedBy: this.context.requireUserId() });
        this.logger.log({ templateId: id, active }, 'role template switched');
      }
      return this.load(tx, id);
    });
  }

  /**
   * The templates, read in the current tenant's transaction (provisioning, a reset). Not gated:
   * a building block for `RolesService`, which checks its own permission.
   */
  forTenant(): Promise<RoleTemplate[]> {
    return this.tenantDb.run((tx) => this.templates.list(tx));
  }

  private async load(
    tx: Parameters<RoleTemplatesRepository['list']>[0],
    id: string,
  ): Promise<RoleTemplate> {
    const template = await this.templates.byId(tx, id);
    if (!template) throw new RoleNotFoundError('Role not found');
    return template;
  }
}
