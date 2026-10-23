import type { Permission } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import {
  assertCanAssign,
  assertCanGrant,
  assertCanManage,
  assertCanRemove,
  assertDeactivatable,
  assertEditable,
  assertNoSelfLockout,
  type Editor,
} from './role-rules';

const editor = (...permissions: Permission[]): Editor => ({
  holdsAll: false,
  permissions: new Set(permissions),
});
const owner: Editor = { holdsAll: true, permissions: new Set() };

describe('assertCanGrant', () => {
  it('lets an editor add what they hold, and remove anything', () => {
    const manager = editor('role:write', 'payment:read');
    expect(() => {
      assertCanGrant(manager, [], ['payment:read']);
    }).not.toThrow();
    expect(() => {
      assertCanGrant(manager, ['finance:read'], []);
    }).not.toThrow();
    expect(() => {
      assertCanGrant(manager, ['finance:read'], ['finance:read']);
    }).not.toThrow();
  });

  it('refuses a permission the editor lacks, naming it', () => {
    expect(() => {
      assertCanGrant(editor('role:write'), [], ['finance:read']);
    }).toThrow(
      expect.objectContaining({
        code: 'role.cannot_grant',
        extensions: { permission: 'finance:read' },
      }),
    );
  });

  it('lets an owner or platform admin grant anything', () => {
    expect(() => {
      assertCanGrant(owner, [], ['finance:read', 'payment:refund']);
    }).not.toThrow();
  });
});

describe('assertCanAssign', () => {
  const frontdesk = { key: 'frontdesk', permissions: ['payment:read' as const] };

  it('needs every permission of the role', () => {
    expect(() => {
      assertCanAssign(editor('role:write', 'payment:read'), [frontdesk]);
    }).not.toThrow();
    expect(() => {
      assertCanAssign(editor('role:write'), [frontdesk]);
    }).toThrow(expect.objectContaining({ code: 'role.cannot_grant' }));
  });

  it('keeps the owner role for owners and platform admins', () => {
    const ownerRole = { key: 'owner', permissions: [] };
    expect(() => {
      assertCanAssign(editor('role:write'), [ownerRole]);
    }).toThrow(
      expect.objectContaining({ code: 'role.cannot_grant', extensions: { permission: 'owner' } }),
    );
    expect(() => {
      assertCanAssign(owner, [ownerRole]);
    }).not.toThrow();
  });
});

describe('assertNoSelfLockout', () => {
  it('refuses losing your own role:write or user:write', () => {
    const before = new Set<Permission>(['role:write', 'user:write', 'finance:read']);
    expect(() => {
      assertNoSelfLockout(before, new Set(['user:write']));
    }).toThrow(
      expect.objectContaining({
        code: 'role.self_lockout',
        extensions: { permission: 'role:write' },
      }),
    );
    expect(() => {
      assertNoSelfLockout(before, new Set(['role:write']));
    }).toThrow(expect.objectContaining({ code: 'role.self_lockout' }));
    expect(() => {
      assertNoSelfLockout(before, new Set(['role:write', 'user:write']));
    }).not.toThrow();
  });

  it('ignores what the caller never had', () => {
    expect(() => {
      assertNoSelfLockout(new Set(['finance:read']), new Set());
    }).not.toThrow();
  });
});

describe('assertEditable and assertDeactivatable', () => {
  it('locks the owner system role only', () => {
    expect(() => {
      assertEditable({ key: 'owner', system: true });
    }).toThrow(expect.objectContaining({ code: 'role.owner_locked' }));
    expect(() => {
      assertEditable({ key: 'dentist', system: true });
    }).not.toThrow();
  });

  it('refuses deactivating a held role, with the count', () => {
    expect(() => {
      assertDeactivatable(3);
    }).toThrow(expect.objectContaining({ code: 'role.has_holders', extensions: { holders: 3 } }));
    expect(() => {
      assertDeactivatable(0);
    }).not.toThrow();
  });
});

describe('assertCanRemove and assertCanManage', () => {
  it('keeps the owner role from being taken away by anyone but an owner or admin', () => {
    expect(() => {
      assertCanRemove(editor('role:write'), ['owner']);
    }).toThrow(expect.objectContaining({ code: 'role.cannot_grant' }));
    expect(() => {
      assertCanRemove(editor('role:write'), ['frontdesk']);
    }).not.toThrow();
    expect(() => {
      assertCanRemove(owner, ['owner']);
    }).not.toThrow();
  });

  it('manages only someone who holds no more than the editor, and never an owner', () => {
    const manager = editor('user:write', 'payment:read');
    expect(() => {
      assertCanManage(manager, { owner: false, permissions: ['payment:read'] });
    }).not.toThrow();
    expect(() => {
      assertCanManage(manager, { owner: false, permissions: ['finance:read'] });
    }).toThrow(
      expect.objectContaining({
        code: 'role.cannot_manage',
        extensions: { permission: 'finance:read' },
      }),
    );
    expect(() => {
      assertCanManage(manager, { owner: true, permissions: [] });
    }).toThrow(expect.objectContaining({ extensions: { permission: 'owner' } }));
    expect(() => {
      assertCanManage(owner, { owner: true, permissions: ['finance:read'] });
    }).not.toThrow();
  });
});
