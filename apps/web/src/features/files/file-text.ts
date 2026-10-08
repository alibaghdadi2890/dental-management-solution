import {
  type FileCategory,
  type FileSubCategory,
  formatVisitNumber,
  type PatientFile,
  type ToothCode,
} from '@dcm/contracts';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/session';
import { useToothLabel } from '@/features/clinical/chart/use-chart-settings';
import { formatCalendarDate, formatDate, formatDateTime } from '@/lib/format';

/** A size as a number and the unit it is best read in: "482" KB, "3.4" MB. */
export function sizeParts(
  bytes: number,
  locale: string,
): { value: string; unit: 'b' | 'kb' | 'mb' } {
  const [amount, unit, digits] =
    bytes >= 1024 * 1024
      ? ([bytes / (1024 * 1024), 'mb', 1] as const)
      : bytes >= 1024
        ? ([bytes / 1024, 'kb', 0] as const)
        : ([bytes, 'b', 0] as const);
  const value = new Intl.NumberFormat(locale === 'en' ? 'en-US' : locale, {
    maximumFractionDigits: digits,
  }).format(amount);
  return { value, unit };
}

/** The glyph of a file that has no thumbnail: what kind of document it is. */
export function glyphOf(
  file: Pick<PatientFile, 'kind' | 'mimeType'>,
): 'pdf' | 'doc' | 'xls' | 'txt' | 'img' {
  if (file.kind === 'image') return 'img';
  if (file.mimeType === 'application/pdf') return 'pdf';
  if (file.mimeType.includes('spreadsheet')) return 'xls';
  return file.mimeType === 'text/plain' ? 'txt' : 'doc';
}

export interface FileFacts {
  category: FileCategory | null;
  subCategory: FileSubCategory | null;
  toothCode: ToothCode | null;
}

/**
 * How a file is named across the feature: "X-ray · Panoramic · Tooth #36", its dates in the
 * clinic's time zone, its visit as "V-000071 · 12 Mar 2026".
 */
export function useFileText() {
  const { t, i18n } = useTranslation('files');
  const locale = i18n.resolvedLanguage ?? 'en';
  const timeZone = useSession().data?.tenant?.timeZone ?? 'UTC';
  const toothLabel = useToothLabel();

  const tooth = useCallback(
    (code: ToothCode) => t('tooth', { tooth: toothLabel(code) }),
    [t, toothLabel],
  );
  const summary = useCallback(
    (file: FileFacts): string =>
      [
        file.category ? t(`category.${file.category}`) : null,
        file.subCategory ? t(`subCategory.${file.subCategory}`) : null,
        file.toothCode ? tooth(file.toothCode) : null,
      ]
        .filter((part) => part !== null)
        .join(t('separator')),
    [t, tooth],
  );
  return useMemo(
    () => ({
      locale,
      timeZone,
      tooth,
      summary,
      size: (bytes: number) => {
        const { value, unit } = sizeParts(bytes, locale);
        return t(`size.${unit}`, { value });
      },
      takenDate: (file: Pick<PatientFile, 'takenAt'>) =>
        formatDate(file.takenAt, { timeZone, locale }),
      dateTime: (iso: string) => formatDateTime(iso, { timeZone, locale }),
      visit: (visit: NonNullable<PatientFile['visit']>) =>
        t('visitField.option', {
          number: formatVisitNumber(visit.displayNumber),
          date: formatCalendarDate(visit.localDate, locale),
        }),
      /** What a screen reader hears for a tile: everything the tile shows, in words. */
      describe: (file: PatientFile) =>
        [summary(file), formatDate(file.takenAt, { timeZone, locale }), file.originalFilename]
          .filter((part) => part !== '')
          .join(t('separator')),
    }),
    [locale, timeZone, tooth, summary, t],
  );
}
