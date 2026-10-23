import type { GrantablePermission, Permission } from '@dcm/contracts';
import {
  CannotGrantError,
  CannotManageError,
  OwnerLockedError,
  RoleHasHoldersError,
  SelfLockoutError,
} from './roles-errors';

/**
 * Who widens access and how far (feature 13a, ADR-0055). Pure rules the roles service runs on
 * every role edit, grant change and role assignment.
 */
export interface Editor {
  /** An owner or a platform admin acting in the tenant: holds every permission. */
  holdsAll: boolean;
  permissions: ReadonlySet<Permission>;
}

const holds = (editor: Editor, permission: Permission) =>
  editor.holdsAll || editor.permissions.has(permission);

/** You can only give what you hold: every permission `after` adds to `before`. */
export function assertCanGrant(
  editor: Editor,
  before: Iterable<GrantablePermission>,
  after: Iterable<GrantablePermission>,
): void {
  const had = new Set(before);
  for (const permission of after) {
    if (!had.has(permission) && !holds(editor, permission)) {
      throw new CannotGrantError(permission);
    }
  }
}

/** Assigning a role gives its permissions: the editor must hold each one, and only an owner or a
 * platform admin hands out `owner`. */
export function assertCanAssign(
  editor: Editor,
  added: readonly { key: string; permissions: readonly GrantablePermission[] }[],
): void {
  for (const role of added) {
    if (role.key === 'owner' && !editor.holdsAll) {
      throw new CannotGrantError('owner');
    }
    assertCanGrant(editor, [], role.permissions);
  }
}

/** Only an owner or a platform admin takes the `owner` role from someone. */
export function assertCanRemove(editor: Editor, removedKeys: readonly string[]): void {
  if (removedKeys.includes('owner') && !editor.holdsAll) {
    throw new CannotGrantError('owner');
  }
}

/**
 * Managing someone's account (their password, status, profile or roles) is acting as them: the
 * editor must hold everything they hold, and only an owner or a platform admin manages an owner.
 */
export function assertCanManage(
  editor: Editor,
  target: { owner: boolean; permissions: Iterable<Permission> },
): void {
  if (editor.holdsAll) return;
  if (target.owner) throw new CannotManageError('owner');
  for (const permission of target.permissions) {
    if (!editor.permissions.has(permission)) throw new CannotManageError(permission);
  }
}

/** The permissions nobody may take from themselves: they could not undo it. */
const SELF_KEPT: readonly Permission[] = ['role:write', 'user:write'];

/** A change to the caller's own access must leave them `role:write` and `user:write` if they had
 * them. */
export function assertNoSelfLockout(
  before: ReadonlySet<Permission>,
  after: ReadonlySet<Permission>,
): void {
  for (const permission of SELF_KEPT) {
    if (before.has(permission) && !after.has(permission)) {
      throw new SelfLockoutError(permission);
    }
  }
}

/** The owner role always holds every permission (ADR-0055). */
export function assertEditable(role: { key: string; system: boolean }): void {
  if (role.system && role.key === 'owner') {
    throw new OwnerLockedError('The owner role always has every permission');
  }
}

export function assertDeactivatable(holders: number): void {
  if (holders > 0) {
    throw new RoleHasHoldersError(holders);
  }
}
