import { useTranslation } from 'react-i18next';
import type { SearchScope } from '../nav-items';

/** The search's name follows what it finds (S2): patients only keeps _Find patient_. */
export function useSearchWords(scope: SearchScope): {
  title: string;
  label: string;
  placeholder: string;
} {
  const { t } = useTranslation(['shell', 'patients']);
  if (!scope.stock) {
    return {
      title: t('patients:palette.title'),
      label: t('patients:palette.label'),
      placeholder: t('patients:palette.placeholder'),
    };
  }
  return scope.patients
    ? {
        title: t('search.all.title'),
        label: t('search.all.label'),
        placeholder: t('search.all.placeholder'),
      }
    : {
        title: t('search.stockOnly.title'),
        label: t('search.stockOnly.label'),
        placeholder: t('search.stockOnly.placeholder'),
      };
}
