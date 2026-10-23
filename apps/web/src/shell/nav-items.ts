import type { Permission, Session } from '@dcm/contracts';

interface NavEntry<TKey extends string, TPath extends string> {
  key: TKey;
  to: TPath;
  /** Shown only when the session holds it, or one of them (UI visibility; the API still
   * enforces). */
  permission: Permission | readonly Permission[];
}

/** Sidebar entries (POC app shell). Schedule is not part of phase 1. Today is the chair lane for
 * whoever sees visits and the checkout lane for whoever sees a patient's money; Payments is the
 * clinic's finances (`finance:read`, ADR-0055). */
export const MAIN_NAV = [
  { key: 'today', to: '/today', permission: 'visit:read' },
  { key: 'patients', to: '/patients', permission: 'patient:read' },
  { key: 'visits', to: '/visits', permission: 'visit:read' },
  { key: 'payments', to: '/payments', permission: 'finance:read' },
] as const satisfies readonly NavEntry<string, string>[];

/** Every clinic role reads the catalog; only `catalog:write` edits it (read-only screen otherwise).
 * Activity is the audit log, for whoever may read it (owner, dentist; feature 7, H7). Settings
 * is the chart, staff and roles: shown with any of them (ADR-0055). */
export const ADMIN_NAV = [
  { key: 'catalog', to: '/catalog', permission: 'catalog:read' },
  { key: 'activity', to: '/activity', permission: 'audit:read' },
  {
    key: 'settings',
    to: '/settings',
    permission: ['tenant:write', 'user:write', 'role:read'],
  },
] as const satisfies readonly NavEntry<string, string>[];

/** The platform's clinics, the default roles new clinics start with (ADR-0056), and every
 * clinic's Activity (ADR-0057). */
export const PLATFORM_NAV = [
  { key: 'tenants', to: '/admin/tenants', permission: 'platform:admin' },
  { key: 'platformActivity', to: '/admin/activity', permission: 'platform:admin' },
  { key: 'defaultRoles', to: '/admin/roles', permission: 'platform:admin' },
] as const satisfies readonly NavEntry<string, string>[];

export type NavItem =
  (typeof MAIN_NAV)[number] | (typeof ADMIN_NAV)[number] | (typeof PLATFORM_NAV)[number];
export type NavKey = NavItem['key'];

export interface VisibleNav {
  main: NavItem[];
  admin: NavItem[];
  platform: NavItem[];
}

/** What the sidebar shows for a session: clinic groups inside a clinic, PLATFORM for admins. */
export function visibleNav(session: Session): VisibleNav {
  const allowed = (item: NavItem) =>
    (typeof item.permission === 'string' ? [item.permission] : item.permission).some((permission) =>
      session.permissions.includes(permission),
    );
  const inClinic = session.tenant !== null;
  return {
    main: inClinic ? MAIN_NAV.filter(allowed) : [],
    admin: inClinic ? ADMIN_NAV.filter(allowed) : [],
    platform: session.platformAdmin ? [...PLATFORM_NAV] : [],
  };
}

/** The header's "Find patient" (and its Ctrl/⌘+K shortcut) and "New patient": only inside a
 * clinic — a platform admin not acting in one has no patients — and only with the permission. */
export function patientActions(session: Session | undefined): { find: boolean; create: boolean } {
  if (!session?.tenant) return { find: false, create: false };
  return {
    find: session.permissions.includes('patient:read'),
    create: session.permissions.includes('patient:write'),
  };
}
