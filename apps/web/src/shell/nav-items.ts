/** Sidebar entries (POC app shell). Schedule and Payments are not part of phase 1. */
export const MAIN_NAV = [
  { key: 'patients', to: '/patients' },
  { key: 'visits', to: '/visits' },
] as const;

export const ADMIN_NAV = [
  { key: 'catalog', to: '/catalog' },
  { key: 'settings', to: '/settings' },
] as const;

export type NavItem = (typeof MAIN_NAV)[number] | (typeof ADMIN_NAV)[number];
export type NavKey = NavItem['key'];
