import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { countryOptions, type CountryOption } from './tenant-options';

/**
 * `countryOptions()` builds an `Intl.DisplayNames` and sorts ~250 entries; cheap once, wasteful on
 * every render of every consumer. Cached per locale at module level for the life of the tab — the
 * list itself never changes within a session.
 */
const optionsByLocale = new Map<string, CountryOption[]>();

function cachedCountryOptions(locale: string): CountryOption[] {
  let options = optionsByLocale.get(locale);
  if (!options) {
    options = countryOptions(locale);
    optionsByLocale.set(locale, options);
  }
  return options;
}

/** The country list labelled for the current UI language, computed once per locale. */
export function useCountryOptions(): CountryOption[] {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  return useMemo(() => cachedCountryOptions(locale), [locale]);
}
