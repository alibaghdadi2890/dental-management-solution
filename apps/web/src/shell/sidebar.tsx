import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/session';
import { ADMIN_NAV, MAIN_NAV, type NavItem } from './nav-items';

function NavLink({ item }: { item: NavItem }) {
  const { t } = useTranslation('shell');
  return (
    <Link
      to={item.to}
      className="group flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] leading-none font-medium text-ink hover:bg-subtle data-[status=active]:bg-primary-tint data-[status=active]:font-semibold data-[status=active]:text-primary"
    >
      <span className="size-[5px] flex-none rounded-full bg-border-control group-data-[status=active]:bg-primary" />
      <span>{t(`nav.${item.key}`)}</span>
    </Link>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

export function Sidebar() {
  const { t } = useTranslation('shell');
  const { data: session } = useSession();
  const tenant = session?.tenant;
  const branch = session?.branch;

  return (
    <aside className="flex w-[212px] flex-none flex-col border-e border-border bg-surface">
      <div className="flex items-center gap-2.5 px-[18px] pt-5 pb-[18px]">
        <div className="grid size-7 flex-none place-items-center rounded-lg bg-primary font-mono text-[13px] leading-none font-semibold text-primary-foreground">
          {t('brand.mark')}
        </div>
        <div className="min-w-0">
          {tenant ? (
            <>
              <div className="truncate text-sm leading-tight font-semibold tracking-[-0.01em]">
                {tenant.name}
              </div>
              {branch && (
                <div className="truncate font-mono text-[11.5px] leading-snug tracking-[0.04em] text-ink-muted uppercase">
                  {t('clinic.branch', { branch: branch.name })}
                </div>
              )}
            </>
          ) : (
            <div
              aria-label={t('clinic.loading')}
              className="h-3.5 w-28 animate-shimmer rounded-sm bg-[linear-gradient(90deg,#f2f0ea,#faf8f4,#f2f0ea)] bg-[length:800px_100%]"
            />
          )}
        </div>
      </div>

      <nav aria-label={t('nav.label')} className="flex flex-col gap-0.5 px-2.5 py-1.5">
        {MAIN_NAV.map((item) => (
          <NavLink key={item.key} item={item} />
        ))}
        <div className="mx-2.5 mt-4 mb-1.5 text-[11.5px] leading-none font-medium tracking-[0.06em] text-ink-muted uppercase">
          {t('nav.admin')}
        </div>
        {ADMIN_NAV.map((item) => (
          <NavLink key={item.key} item={item} />
        ))}
      </nav>

      {session && (
        <div className="mt-auto flex items-center gap-[9px] border-t border-border p-3">
          <div className="grid size-7 flex-none place-items-center rounded-full border border-primary-tint-border bg-primary-tint text-[11.5px] leading-none font-semibold text-primary">
            {initials(session.user.displayName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] leading-[1.3] font-medium">
              {session.user.displayName}
            </div>
            <div className="text-[11.5px] leading-[1.3] text-ink-muted">
              {session.roleNames[0] ?? t('user.fallbackRole')}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
