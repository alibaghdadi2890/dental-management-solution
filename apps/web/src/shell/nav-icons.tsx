import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { NavKey } from './nav-items';

/** 16px line icons for the sidebar entries: the whole menu when it is collapsed. */
const PATHS: Record<NavKey, ReactNode> = {
  today: (
    <>
      <rect x="2.25" y="3" width="11.5" height="10.75" rx="2" />
      <path d="M2.25 6.5h11.5M5.5 1.75v2.5M10.5 1.75v2.5" />
      <circle cx="8" cy="10.1" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  patients: (
    <>
      <circle cx="6" cy="5.25" r="2.5" />
      <path d="M1.75 13.5c.5-2.4 2.2-3.75 4.25-3.75s3.75 1.35 4.25 3.75M10.25 2.9a2.5 2.5 0 0 1 0 4.7M11.9 9.9c1.2.55 2 1.65 2.35 3.6" />
    </>
  ),
  visits: (
    <path d="M5.1 2.25c-1.9 0-3.1 1.4-3.1 3.45 0 1.55.6 2.55 1 3.85.45 1.45.55 4.2 1.85 4.2 1.15 0 1.1-2.85 2.1-3.85a1.45 1.45 0 0 1 2.1 0c1 1 .95 3.85 2.1 3.85 1.3 0 1.4-2.75 1.85-4.2.4-1.3 1-2.3 1-3.85 0-2.05-1.2-3.45-3.1-3.45-1.2 0-1.85.6-2.9.6s-1.7-.6-2.9-.6Z" />
  ),
  payments: (
    <>
      <rect x="1.75" y="3.5" width="12.5" height="9" rx="1.75" />
      <path d="M1.75 6.5h12.5M4.5 9.75h2.5" />
    </>
  ),
  catalog: (
    <>
      <path d="M6 4h8M6 8h8M6 12h8" />
      <circle cx="2.75" cy="4" r=".9" fill="currentColor" stroke="none" />
      <circle cx="2.75" cy="8" r=".9" fill="currentColor" stroke="none" />
      <circle cx="2.75" cy="12" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  activity: <path d="M1.75 8.25h2.6l1.9-4.75 3.5 9 1.9-4.25h2.6" />,
  settings: (
    <>
      <path d="M1.75 4.5h7M12.25 4.5h2M1.75 11.5h2M7.25 11.5h7" />
      <circle cx="10.5" cy="4.5" r="1.75" />
      <circle cx="5.5" cy="11.5" r="1.75" />
    </>
  ),
  tenants: (
    <path d="M3 13.75V3.25c0-.55.45-1 1-1h5c.55 0 1 .45 1 1v10.5M10 6.25h2c.55 0 1 .45 1 1v6.5M1.75 13.75h12.5M5.5 5h2M5.5 7.75h2M5.5 10.5h2" />
  ),
};

export function NavIcon({ navKey, className }: { navKey: NavKey; className?: string }) {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('flex-none', className)}
    >
      {PATHS[navKey]}
    </svg>
  );
}
