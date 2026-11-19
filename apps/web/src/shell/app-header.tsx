import type { Session } from '@dcm/contracts';
import { useMatches } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SearchIcon } from '@/components/ui/search-icon';
import { PatientsTray } from '@/features/alerts/patients-tray';
import { CheckoutPill } from '@/features/clinical/checkout-pill';
import { usePatientNavigation } from '@/features/patients/patient-navigation';
import { patientActions, searchScope } from './nav-items';

/** The shortcut hint reads "⌘K" on Apple devices, "Ctrl K" everywhere else. */
const APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

export function AppHeader({
  session,
  onFindPatient,
}: {
  session: Session | undefined;
  /** Opens the search (the header button and Ctrl/⌘+K). */
  onFindPatient: () => void;
}) {
  const { t } = useTranslation(['shell', 'common']);
  const { openNewPatient } = usePatientNavigation();
  const navKey = useMatches({
    select: (matches) => matches.findLast((match) => match.staticData.navKey)?.staticData.navKey,
  });
  const context =
    navKey === 'tenants' || navKey === 'defaultRoles' || navKey === 'platformActivity'
      ? t('platformCrumb')
      : session?.tenant?.name;
  const actions = patientActions(session);
  const scope = searchScope(session);
  const canSearch = scope.patients || scope.stock;
  // The button's words follow what the search finds (S2).
  const searchLabel = !scope.stock
    ? t('header.findPatient')
    : scope.patients
      ? t('header.search')
      : t('header.searchStock');

  return (
    <header className="flex h-14 flex-none items-center gap-3.5 border-b border-border bg-surface px-[22px] print:hidden">
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
      {session?.tenant && <PatientsTray />}
      {session?.tenant && <CheckoutPill />}
      {(canSearch || actions.create) && (
        <div className="ms-auto flex min-w-0 items-center gap-2">
          {canSearch && (
            <button
              type="button"
              aria-haspopup="dialog"
              aria-keyshortcuts="Control+K Meta+K"
              onClick={onFindPatient}
              className="flex h-[34px] w-[260px] max-w-[34vw] min-w-0 cursor-pointer items-center gap-[9px] rounded-lg border border-border bg-faint px-[11px] text-start hover:border-border-strong hover:bg-surface"
            >
              <SearchIcon className="text-ink-muted" />
              <span className="min-w-0 flex-1 truncate text-[12.5px] leading-none text-ink-muted">
                {searchLabel}
              </span>
              <kbd
                aria-hidden
                dir="ltr"
                className="flex-none rounded-sm border border-border bg-surface px-[5px] py-[3px] font-mono text-[11.5px] leading-none font-medium text-ink-muted"
              >
                {APPLE ? t('header.shortcutApple') : t('header.shortcutOther')}
              </kbd>
            </button>
          )}
          {actions.create && (
            <Button
              variant="primary"
              size="toolbar"
              className="gap-[7px]"
              onClick={() => {
                openNewPatient();
              }}
            >
              <svg
                aria-hidden
                width="12"
                height="12"
                viewBox="0 0 12 12"
                stroke="currentColor"
                strokeWidth="1.8"
                className="flex-none"
              >
                <path d="M6 1.6v8.8M1.6 6h8.8" />
              </svg>
              {t('header.newPatient')}
            </Button>
          )}
        </div>
      )}
    </header>
  );
}
