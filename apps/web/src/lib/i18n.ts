import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

export const SUPPORTED_LANGUAGES = ['en', 'ar', 'fr'] as const;
export const NAMESPACES = [
  'common',
  'shell',
  'auth',
  'admin',
  'patients',
  'billing',
  'visits',
  'catalog',
  'settings',
] as const;

type Messages = Record<string, unknown>;

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
    detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'] },
  });

export default i18n;
