import type { Session } from '@dcm/contracts';
import { useMatches } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export function AppHeader({ session }: { session: Session | undefined }) {
  const { t } = useTranslation(['shell', 'common']);
  const navKey = useMatches({
    select: (matches) => matches.findLast((match) => match.staticData.navKey)?.staticData.navKey,
  });
  const context = navKey === 'tenants' ? t('platformCrumb') : session?.tenant?.name;

  return (
    <header className="flex h-14 flex-none items-center gap-3.5 border-b border-border bg-surface px-[22px]">
      <nav
        aria-label={t('breadcrumb')}
        className="flex flex-none items-center gap-2 text-[12.5px] leading-none whitespace-nowrap text-ink-muted"
      >
        <span>{context ?? t('common:appName')}</span>
        {navKey && (
          <>
            <span aria-hidden className="text-border-strong">
              {'/'}
            </span>
            <span className="font-medium text-ink">{t(`nav.${navKey}`)}</span>
          </>
        )}
      </nav>
    </header>
  );
}
