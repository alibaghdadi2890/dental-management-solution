import type { GrantablePermission } from './permissions.js';

/**
 * The capability catalog (feature 13a, ADR-0055): how the permission editors show the grantable
 * permissions — in groups, each with a translated label and description (`roles` namespace,
 * `capabilityI18nKey`) — and what each one needs. The single source for both editors in the SPA;
 * the raw key is only a tooltip.
 */
export const CAPABILITY_GROUPS = [
  { key: 'patients', permissions: ['patient:read', 'patient:write'] },
  {
    key: 'visits',
    permissions: ['visit:read', 'visit:read_all', 'visit:write', 'visit:amend', 'visit:void'],
  },
  { key: 'clinical', permissions: ['chart:write'] },
  {
    key: 'money',
    permissions: [
      'payment:read',
      'payment:write',
      'payment:refund',
      'finance:read',
      'visit:discount',
    ],
  },
  { key: 'catalog', permissions: ['catalog:read', 'catalog:write'] },
  { key: 'files', permissions: ['file:read', 'file:write', 'file:archive'] },
  { key: 'staff', permissions: ['user:read', 'user:write', 'role:read', 'role:write'] },
  { key: 'compensation', permissions: ['compensation:read', 'compensation:manage'] },
  { key: 'activity', permissions: ['audit:read'] },
  { key: 'clinic', permissions: ['tenant:read', 'tenant:write', 'import:run'] },
] as const satisfies readonly {
  key: string;
  permissions: readonly GrantablePermission[];
}[];

export type CapabilityGroupKey = (typeof CAPABILITY_GROUPS)[number]['key'];

/**
 * What a permission needs to make sense: ticked with it, and locked on while it is on. Every write
 * of a role or a grant set is closed under it (`closeImplied`).
 */
export const CAPABILITY_IMPLIES: Readonly<
  Partial<Record<GrantablePermission, readonly GrantablePermission[]>>
> = {
  'visit:read_all': ['visit:read'],
  'visit:write': ['visit:read'],
  // Each acts on a visit it must first be able to load.
  'visit:amend': ['visit:read'],
  'visit:void': ['visit:read'],
  'visit:discount': ['visit:read'],
  'chart:write': ['visit:read'],
  'payment:write': ['payment:read'],
  'payment:refund': ['payment:read'],
  'finance:read': ['payment:read'],
  'compensation:manage': ['compensation:read'],
  'user:write': ['user:read'],
  // Giving people access means seeing who they are.
  'role:write': ['role:read', 'user:read'],
};

/** Catalog order: the order of the groups, then within each group. */
const ORDER: readonly GrantablePermission[] = CAPABILITY_GROUPS.flatMap(
  (group) => group.permissions,
);

const ordered = (set: ReadonlySet<GrantablePermission>): GrantablePermission[] =>
  ORDER.filter((permission) => set.has(permission));

/** The set plus everything it implies, transitively, in catalog order. */
export function closeImplied(permissions: Iterable<GrantablePermission>): GrantablePermission[] {
  const closed = new Set<GrantablePermission>();
  const visit = (permission: GrantablePermission) => {
    if (closed.has(permission)) return;
    closed.add(permission);
    for (const implied of CAPABILITY_IMPLIES[permission] ?? []) visit(implied);
  };
  for (const permission of permissions) visit(permission);
  return ordered(closed);
}

/** The permissions of `set` that hold `permission` on (directly or transitively), in order. */
export function impliedBy(
  permission: GrantablePermission,
  set: Iterable<GrantablePermission>,
): GrantablePermission[] {
  const holders = new Set<GrantablePermission>();
  for (const candidate of set) {
    if (candidate !== permission && closeImplied([candidate]).includes(permission)) {
      holders.add(candidate);
    }
  }
  return ordered(holders);
}

/** The i18n key stem of a permission: `capability.<stem>.label` / `.description` (`roles`). */
export const capabilityI18nKey = (permission: GrantablePermission): string =>
  permission.replace(':', '_');
