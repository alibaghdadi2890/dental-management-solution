import { useMatches } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/session';

export function AppHeader() {
  const { t } = useTranslation(['shell', 'common']);
  const { data: session } = useSession();
  const navKey = useMatches({
    select: (matches) => matches.findLast((match) => match.staticData.navKey)?.staticData.navKey,
  });

  return (
    <header className="flex h-14 flex-none items-center gap-3.5 border-b border-border bg-surface px-[22px]">
      <nav
        aria-label={t('breadcrumb')}
        className="flex flex-none items-center gap-2 text-[12.5px] leading-none whitespace-nowrap text-ink-muted"
      >
        <span>{session?.tenant?.name ?? t('common:appName')}</span>
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
