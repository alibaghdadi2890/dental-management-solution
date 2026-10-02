import type { Session } from '@dcm/contracts';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '@/components/language-switch';
import { IconButton } from '@/components/ui/button';
import { useSignOut } from '@/features/auth/use-sign-out';
import { useRoleLabel } from '@/features/users/role-label';
import { initials } from '@/lib/initials';
import { BranchSwitcher } from './branch-switcher';
import { type NavItem, visibleNav } from './nav-items';

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

function NavGroup({ label, items }: { label?: string; items: NavItem[] }) {
  if (items.length === 0) return null;
  return (
    <>
      {label && (
        <div className="mx-2.5 mt-4 mb-1.5 text-[11.5px] leading-none font-medium tracking-[0.06em] text-ink-muted uppercase">
          {label}
        </div>
      )}
      {items.map((item) => (
        <NavLink key={item.key} item={item} />
      ))}
    </>
  );
}

function ClinicBlock({ session }: { session: Session }) {
  const { t } = useTranslation('shell');
  const platformOnly = session.platformAdmin && session.tenant === null;
  return (
    <div className="flex items-center gap-2.5 px-[18px] pt-5 pb-[18px]">
      <div className="grid size-7 flex-none place-items-center rounded-lg bg-primary font-mono text-[13px] leading-none font-semibold text-primary-foreground">
        {platformOnly ? t('brand.platformMark') : t('brand.mark')}
      </div>
      <div className="min-w-0">
        {platformOnly ? (
          <>
            <div className="truncate text-sm leading-tight font-semibold tracking-[-0.01em]">
              {t('clinic.platformAdmin')}
            </div>
            <div className="truncate font-mono text-[11.5px] leading-snug tracking-[0.04em] text-ink-muted uppercase">
              {t('clinic.platformSubtitle')}
            </div>
          </>
        ) : (
          <>
            <div
              dir="auto"
              className="truncate text-sm leading-tight font-semibold tracking-[-0.01em] [unicode-bidi:isolate]"
            >
              {session.tenant?.name}
            </div>
            <BranchSwitcher branch={session.branch} branches={session.branches} />
          </>
        )}
      </div>
    </div>
  );
}

export function Sidebar({ session }: { session: Session | undefined }) {
  const { t } = useTranslation('shell');
  const roleLabel = useRoleLabel();
  const signOut = useSignOut();
  const nav = session ? visibleNav(session) : undefined;

  return (
    <aside className="flex w-[212px] flex-none flex-col border-e border-border bg-surface">
      {session ? (
        <ClinicBlock session={session} />
      ) : (
        <div className="px-[18px] pt-5 pb-[18px]">
          <div
            aria-label={t('clinic.loading')}
            className="h-3.5 w-28 animate-shimmer rounded-sm bg-[linear-gradient(90deg,#f2f0ea,#faf8f4,#f2f0ea)] bg-[length:800px_100%]"
          />
        </div>
      )}

      {nav && (
        <nav aria-label={t('nav.label')} className="flex flex-col gap-0.5 px-2.5 py-1.5">
          <NavGroup items={nav.main} />
          <NavGroup label={t('nav.admin')} items={nav.admin} />
          <NavGroup label={t('nav.platform')} items={nav.platform} />
        </nav>
      )}

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
              {session.platformAdmin
                ? t('user.platformAdmin')
                : session.roles[0]
                  ? roleLabel(session.roles[0])
                  : t('user.fallbackRole')}
            </div>
          </div>
          <div className="flex flex-none">
            <LanguageSwitch label={t('user.language')} />
            <IconButton
              aria-label={t('user.signOut')}
              title={t('user.signOut')}
              onClick={() => {
                void signOut();
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="rtl:-scale-x-100"
              >
                <path d="M6 2.5H3.5v11H6M10 5l3 3-3 3M13 8H6.5" />
              </svg>
            </IconButton>
          </div>
        </div>
      )}
    </aside>
  );
}
