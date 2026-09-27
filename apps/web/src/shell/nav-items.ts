import type { Permission, Session } from '@dcm/contracts';

interface NavEntry<TKey extends string, TPath extends string> {
  key: TKey;
  to: TPath;
  /** Shown only when the session holds it (UI visibility; the API still enforces). */
  permission: Permission;
}

/** Sidebar entries (POC app shell). Schedule and Payments are not part of phase 1. */
export const MAIN_NAV = [
  { key: 'patients', to: '/patients', permission: 'patient:read' },
  { key: 'visits', to: '/visits', permission: 'visit:read' },
] as const satisfies readonly NavEntry<string, string>[];

/** Every clinic role reads the catalog; only `catalog:write` edits it (read-only screen otherwise). */
export const ADMIN_NAV = [
  { key: 'catalog', to: '/catalog', permission: 'catalog:read' },
  { key: 'settings', to: '/settings', permission: 'tenant:write' },
] as const satisfies readonly NavEntry<string, string>[];

export const PLATFORM_NAV = [
  { key: 'tenants', to: '/admin/tenants', permission: 'platform:admin' },
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
  const allowed = (item: NavItem) => session.permissions.includes(item.permission);
  const inClinic = session.tenant !== null;
  return {
    main: inClinic ? MAIN_NAV.filter(allowed) : [],
    admin: inClinic ? ADMIN_NAV.filter(allowed) : [],
    platform: session.platformAdmin ? [...PLATFORM_NAV] : [],
  };
}
