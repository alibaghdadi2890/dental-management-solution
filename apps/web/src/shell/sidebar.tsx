import type { Session } from '@dcm/contracts';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '@/components/language-switch';
import { IconButton } from '@/components/ui/button';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { useSignOut } from '@/features/auth/use-sign-out';
import { useRoleLabel } from '@/features/users/role-label';
import { initials } from '@/lib/initials';
import { cn } from '@/lib/utils';
import { BranchMenu, BranchSwitcher } from './branch-switcher';
import { NavIcon } from './nav-icons';
import { type NavItem, visibleNav } from './nav-items';
import { useSidebarCollapsed } from './use-sidebar-collapsed';

function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const { t } = useTranslation('shell');
  const label = t(`nav.${item.key}`);
  return (
    <Tooltip label={collapsed && label}>
      <Link
        to={item.to}
        className={cn(
          'group flex h-[34px] w-full flex-none items-center gap-2.5 rounded-lg px-2.5 text-[13px] leading-none font-medium text-ink hover:bg-subtle data-[status=active]:bg-primary-tint data-[status=active]:font-semibold data-[status=active]:text-primary',
          collapsed && 'justify-center px-0',
        )}
      >
        <NavIcon
          navKey={item.key}
          className="text-ink-muted group-hover:text-ink group-data-[status=active]:text-primary"
        />
        <span className={collapsed ? 'sr-only' : 'truncate whitespace-nowrap'}>{label}</span>
      </Link>
    </Tooltip>
  );
}

function NavGroup({
  label,
  items,
  collapsed,
}: {
  label?: string;
  items: NavItem[];
  collapsed: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <>
      {label &&
        (collapsed ? (
          <div
            role="separator"
            aria-label={label}
            className="mx-2 my-2.5 h-px flex-none bg-border"
          />
        ) : (
          <div className="mx-2.5 mt-4 mb-1.5 text-[11.5px] leading-none font-medium tracking-[0.06em] whitespace-nowrap text-ink-muted uppercase">
            {label}
          </div>
        ))}
      {items.map((item) => (
        <NavLink key={item.key} item={item} collapsed={collapsed} />
      ))}
    </>
  );
}

const MARK =
  'grid size-7 flex-none place-items-center rounded-lg bg-primary font-mono text-[13px] leading-none font-semibold text-primary-foreground';

/** Collapsed, the clinic block is its mark: the clinic and branch in a tooltip, and the branch
 * menu behind it when there is more than one branch. */
function CollapsedClinicMark({ session }: { session: Session }) {
  const { t } = useTranslation('shell');
  const platformOnly = session.platformAdmin && session.tenant === null;
  const { branch, branches } = session;
  const name = platformOnly ? t('clinic.platformAdmin') : (session.tenant?.name ?? '');
  const label = branch && !platformOnly ? `${name} · ${branch.name}` : name;
  const mark = platformOnly ? t('brand.platformMark') : t('brand.mark');

  return (
    <div className="flex justify-center pt-5 pb-[18px]">
      {!platformOnly && branch && branches.length > 1 ? (
        <Tooltip label={label}>
          <span className="inline-flex">
            <BranchMenu branch={branch} branches={branches}>
              <button
                type="button"
                aria-label={`${t('clinic.switchBranch')} · ${label}`}
                className={cn(MARK, 'cursor-pointer hover:bg-primary-hover')}
              >
                {mark}
              </button>
            </BranchMenu>
          </span>
        </Tooltip>
      ) : (
        <Tooltip label={label}>
          <div className={MARK}>
            <span aria-hidden>{mark}</span>
            <span className="sr-only">{label}</span>
          </div>
        </Tooltip>
      )}
    </div>
  );
}

function ClinicBlock({ session }: { session: Session }) {
  const { t } = useTranslation('shell');
  const platformOnly = session.platformAdmin && session.tenant === null;
  return (
    <div className="flex items-center gap-2.5 px-[18px] pt-5 pb-[18px]">
      <div className={MARK}>{platformOnly ? t('brand.platformMark') : t('brand.mark')}</div>
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

/** Sits at the bottom of the menu, in the same place in both states. */
function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useTranslation('shell');
  const label = collapsed ? t('nav.expand') : t('nav.collapse');
  return (
    <div className="px-2.5 pb-2">
      <Tooltip label={collapsed && label}>
        <button
          type="button"
          aria-label={label}
          onClick={onToggle}
          className={cn(
            'flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[12.5px] leading-none font-medium whitespace-nowrap text-ink-muted hover:bg-subtle hover:text-ink',
            collapsed && 'justify-center px-0',
          )}
        >
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
            className="flex-none rtl:-scale-x-100"
          >
            <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2" />
            <path
              d={collapsed ? 'M5.75 2.25v11.5M8.75 6l2 2-2 2' : 'M5.75 2.25v11.5M10.75 6l-2 2 2 2'}
            />
          </svg>
          {!collapsed && <span>{label}</span>}
        </button>
      </Tooltip>
    </div>
  );
}

/** The app sidebar: 212px with labels, or 60px of icons (each with its label in a tooltip) when
 * collapsed; the choice is kept per browser (`useSidebarCollapsed`). */
export function Sidebar({ session }: { session: Session | undefined }) {
  const { t } = useTranslation('shell');
  const roleLabel = useRoleLabel();
  const signOut = useSignOut();
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const nav = session ? visibleNav(session) : undefined;
  let role = '';
  if (session) {
    if (session.platformAdmin) role = t('user.platformAdmin');
    else role = session.roles[0] ? roleLabel(session.roles[0]) : t('user.fallbackRole');
  }

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        data-collapsed={collapsed || undefined}
        className={cn(
          'flex flex-none flex-col overflow-hidden border-e border-border bg-surface transition-[width] duration-150 ease-out motion-reduce:transition-none',
          collapsed ? 'w-[60px]' : 'w-[212px]',
        )}
      >
        {session ? (
          collapsed ? (
            <CollapsedClinicMark session={session} />
          ) : (
            <ClinicBlock session={session} />
          )
        ) : (
          <div className={cn('pt-5 pb-[18px]', collapsed ? 'flex justify-center' : 'px-[18px]')}>
            <div
              aria-label={t('clinic.loading')}
              className={cn(
                'animate-shimmer bg-[linear-gradient(90deg,#f2f0ea,#faf8f4,#f2f0ea)] bg-[length:800px_100%]',
                collapsed ? 'size-7 rounded-lg' : 'h-3.5 w-28 rounded-sm',
              )}
            />
          </div>
        )}

        {nav && (
          <nav
            aria-label={t('nav.label')}
            className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 py-1.5"
          >
            <NavGroup items={nav.main} collapsed={collapsed} />
            <NavGroup label={t('nav.admin')} items={nav.admin} collapsed={collapsed} />
            <NavGroup label={t('nav.platform')} items={nav.platform} collapsed={collapsed} />
          </nav>
        )}

        <div className="mt-auto">
          <CollapseToggle collapsed={collapsed} onToggle={toggleCollapsed} />
          {session && (
            <div
              className={cn(
                'flex border-t border-border p-3',
                collapsed ? 'flex-col items-center gap-1.5 px-0' : 'items-center gap-[9px]',
              )}
            >
              <Tooltip label={collapsed && `${session.user.displayName} · ${role}`}>
                <div className="grid size-7 flex-none place-items-center rounded-full border border-primary-tint-border bg-primary-tint text-[11.5px] leading-none font-semibold text-primary">
                  {initials(session.user.displayName)}
                </div>
              </Tooltip>
              <div className={collapsed ? 'sr-only' : 'min-w-0 flex-1'}>
                <div className="truncate text-[12.5px] leading-[1.3] font-medium">
                  {session.user.displayName}
                </div>
                <div className="truncate text-[11.5px] leading-[1.3] text-ink-muted">{role}</div>
              </div>
              <div className={cn('flex flex-none', collapsed && 'flex-col items-center gap-0.5')}>
                <LanguageSwitch label={t('user.language')} align={collapsed ? 'start' : 'end'} />
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
        </div>
      </aside>
    </TooltipProvider>
  );
}
