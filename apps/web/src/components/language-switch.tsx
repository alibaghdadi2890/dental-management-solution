import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/button';
import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from '@/components/ui/menu';
import { LANGUAGE_NAMES, type Language, SUPPORTED_LANGUAGES } from '@/lib/i18n';

function GlobeIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      className="flex-none"
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M1.75 8h12.5M8 1.75c1.8 1.7 2.7 3.8 2.7 6.25S9.8 12.55 8 14.25C6.2 12.55 5.3 10.45 5.3 8S6.2 3.45 8 1.75Z" />
    </svg>
  );
}

const isLanguage = (value: string | undefined): value is Language =>
  SUPPORTED_LANGUAGES.some((language) => language === value);

/**
 * The UI language switch: a menu of the supported languages, each in its own name, the current
 * one checked. Picking one calls `i18n.changeLanguage`, so every string, `<html lang dir>` and the
 * locale-aware formats follow, and the language detector keeps the choice in `localStorage` for
 * the next visit. `icon` is the sidebar's 30px globe button beside Sign out; `labelled` adds the
 * current language's name, for the sign-in page. `label` is its accessible name ("Language").
 */
export function LanguageSwitch({
  label,
  variant = 'icon',
  align = 'end',
}: {
  label: string;
  variant?: 'icon' | 'labelled';
  align?: 'start' | 'end';
}) {
  const { i18n } = useTranslation();
  const current = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'en';

  return (
    <Menu>
      <MenuTrigger asChild>
        {variant === 'icon' ? (
          <IconButton aria-label={label} title={label}>
            <GlobeIcon />
          </IconButton>
        ) : (
          <button
            type="button"
            aria-label={label}
            title={label}
            className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border-control bg-surface px-2 text-[12.5px] leading-none font-medium text-ink-secondary hover:border-primary hover:text-primary"
          >
            <GlobeIcon />
            <span lang={current}>{LANGUAGE_NAMES[current]}</span>
          </button>
        )}
      </MenuTrigger>
      <MenuContent align={align} className="w-[160px]">
        <MenuRadioGroup
          value={current}
          onValueChange={(next) => {
            if (next !== current) void i18n.changeLanguage(next);
          }}
        >
          {SUPPORTED_LANGUAGES.map((language) => (
            <MenuRadioItem key={language} value={language}>
              <span lang={language} dir={i18n.dir(language)}>
                {LANGUAGE_NAMES[language]}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
