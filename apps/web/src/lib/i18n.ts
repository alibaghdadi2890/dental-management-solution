import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

export const SUPPORTED_LANGUAGES = ['en', 'ar', 'fr'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Each language in its own name (an endonym), the same whatever the UI language: the language
 * switch lists them so a user can find theirs without reading the current one. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  ar: 'العربية',
  fr: 'Français',
};
export const NAMESPACES = [
  'common',
  'shell',
  'auth',
  'admin',
  'patients',
  'billing',
  'visits',
  'catalog',
  'clinical',
  'settings',
] as const;

type Messages = Record<string, unknown>;

/** Where the user's own language choice is kept (the detector's default key). */
const STORAGE_KEY = 'i18nextLng';

// One JSON file per language and feature namespace: locales/<lng>/<namespace>.json
const files = import.meta.glob<Messages>('../locales/*/*.json', { eager: true, import: 'default' });

const resources: Record<string, Record<string, Messages>> = {};
for (const [path, messages] of Object.entries(files)) {
  const [, lng, ns] = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path) ?? [];
  if (lng && ns) {
    resources[lng] = { ...resources[lng], [ns]: messages };
  }
}

function applyDirection(lng: string): void {
  document.documentElement.lang = lng;
  document.documentElement.dir = i18n.dir(lng);
}

i18n.on('languageChanged', applyDirection);

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: SUPPORTED_LANGUAGES,
    fallbackLng: 'en',
    nonExplicitSupportedLngs: true,
    ns: NAMESPACES,
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    // Only an explicit pick is saved (`chooseLanguage`): until then the clinic's language applies
    // over the browser's (`applyClinicLanguage`, 4a follow-up).
    detection: {
      order: ['localStorage', 'navigator'],
      caches: [],
      lookupLocalStorage: STORAGE_KEY,
    },
  });

function savedLanguage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The language switch: changes the UI language and remembers it as this browser's choice. */
export function chooseLanguage(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Private mode: the choice holds for this visit only.
  }
  void i18n.changeLanguage(language);
}

/**
 * The UI language order: the user's saved choice, else the clinic's language (`tenant.locale`,
 * once the session is in), else the browser's. Does nothing once a choice is saved.
 */
export function applyClinicLanguage(locale: string): void {
  if (savedLanguage() !== null) return;
  if (!SUPPORTED_LANGUAGES.some((language) => language === locale)) return;
  if (i18n.resolvedLanguage !== locale) void i18n.changeLanguage(locale);
}

export default i18n;
